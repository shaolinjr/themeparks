"use strict";

// this is our web scraping library, which we need to get wait times and opening hours
var osmosis = require("osmosis");
// cookie library for reading geocookie for wait times
var cookie = require("cookie");

var Moment = require("moment-timezone");

var Park = require("../park");
var GeoLocation = require("../geoLocation");

var s_parkID = Symbol();
var s_parkKind = Symbol();
var s_parkLocationMin = Symbol();
var s_parkLocationMax = Symbol();

// token history (maybe we can just calculate it instead of fetching it??)
// 25th 17:30: 2Gz2/J+AAhLVQsYnVWXzmFRR
// 25th 18:00: 2Gz2/J+AAhLVQsYnVWXzmFRR
// September 25th: 2Gz24oWAAhLVQsYnVWXzmFRS
// September 5th:  2GH25YWLFRfNG9QlVGL1kV9XCg==
// August 29th:    2GD2/J+AAhLVQsYnVWXzmVRe
// August 28th:    2GD2/J+AAhLVQsYnVWXzmVRe
// July 31st:      2GT24oWAAhLVQsYnVWXzllVW
// July 13th:      2WP25ZibFADIA403VmPyl1ZQDbc=
// May 31st:       2WX25YWLFRfNG9QlVGL1kVNUDQ==
// May 30th:       2WX2/J+AAhLVQsYnVWXzlFVX
// April 17th:     2mH24oWAAhLVQsYnVWXzlVdQ
// April 16th:     2mH24pGaEwHIA403VmPyl1ZTDbU=

/**
 * Implements the Tokyo Disneyland API framework.
 * @class
 * @extends Park
 */
class DisneyTokyoPark extends Park {
    /**
     * Create new DisneyTokyoPark Object.
     * This object should not be called directly, but rather extended for each of the individual Tokyo Disneyland parks
     * @param {Object} options
     * @param {String} options.park_id Tokyo Disneyland API park ID
     */
    constructor(options = {}) {
        options.name = options.name || "Tokyo Disneyland Park";

        // inherit from base class
        super(options);

        // assign park configurations
        if (!options.park_id) throw new Error("Missing park's API ID");
        this[s_parkID] = options.park_id;
        if (!options.park_kind) throw new Error("Missing park's kind ID");
        this[s_parkKind] = options.park_kind;
        // geoip range for generating valid cookie
        //  specify as two Location points
        if (!options.location_min || !(options.location_min instanceof GeoLocation)) throw new Error("Missing park's min location");
        if (!options.location_max || !(options.location_max instanceof GeoLocation)) throw new Error("Missing park's max location");
        this[s_parkLocationMin] = options.location_min;
        this[s_parkLocationMax] = options.location_max;
    }

    // override Fastpass Getter to declare support for Fastpass
    get FastPass() {
        return true;
    }

    /**
     * Refresh/Fetch new Wait Times for this Tokyo Disney Resort park
     * @returns {Promise}
     */
    FetchWaitTimes() {
        return new Promise(function(resolve, reject) {
            // get our access token
            this.GetAcccessToken().then(function(access_token) {
                // get ride data
                this.GetRideNames().then(function(rideData) {
                    // we need to loop through rides first, then apply them
                    //  the site returns zero data out-of-hours, so we need to manually inject known-rides when data is missing
                    var currentRideStatus = {};

                    // request wait times URL
                    osmosis.get(`http://info.tokyodisneyresort.jp/rt/s/realtime/${this[s_parkID]}_attraction.html`)
                        .config("headers", {
                            "Cookie": "tdrloc=" + encodeURIComponent(access_token)
                        })
                        .find(".schedule .midArw > a")
                        .set({
                            "link": "@href",
                            "waittime": ".waitTime",
                            // if FastPass tickets are still available
                            "fastpassAvailable": ".fp",
                            // if FastPass should be available, but they ran out of tickets
                            "fastpassExpired": ".fp-no",
                            // look for various closed notices
                            "closedNotice": ".run",
                        })
                        // append TDR_OSMOSIS to each log message from osmosis
                        .log(function() {
                            var logMessage = [].splice.call(arguments, 0);
                            logMessage.splice(0, 0, "TDR_OSMOSIS");
                            this.Log.apply(this, logMessage);
                        }.bind(this))
                        // callback for each ride on the page
                        .data(function(ride) {
                            // ignore if we didn't find a link
                            if (!ride.link) return;

                            // extract ride ID from it's link
                            var ride_id_match = /attraction\/detail\/str_id\:([a-z0-9_]+)/gi.exec(ride.link);
                            // skip if this isn't a ride
                            if (!ride_id_match) return;

                            // parse Int from string
                            var waitTime = parseInt(ride.waittime, 10);

                            if (ride.closedNotice) {
                                if (
                                    // ride down for refurb/off-season (closed all day)
                                    (ride.closedNotice.indexOf("運営・公演中止") >= 0) ||
                                    // ride unexpectedly closed
                                    (ride.closedNotice.indexOf("一時運営中止") >= 0) ||
                                    // "special type" closed, for non-standard attractions such as walking experiences or transport
                                    (ride.closedNotice.indexOf("案内終了") >= 0)
                                ) {
                                    waitTime = -1;
                                }
                            }
                            // push to our object for using in done() later
                            currentRideStatus[ride_id_match[1]] = {
                                // wait time
                                WaitTime: isNaN(waitTime) ? -1 : waitTime,
                                // FastPass status (based on presence of either of these HTML elements)
                                FastPass: (ride.fastpassAvailable || ride.fastpassExpired) ? true : false,
                            };
                        }.bind(this)).done(function() {
                            // now we're done parsing, check for any rides not on the website
                            for (var rideID in rideData) {
                                var rideObject = this.GetRideObject({
                                    id: rideID,
                                    name: rideData[rideID]
                                });

                                if (rideObject) {
                                    if (currentRideStatus[rideID]) {
                                        // update ride with new waittime data
                                        rideObject.WaitTime = currentRideStatus[rideID].WaitTime;
                                        rideObject.FastPass = currentRideStatus[rideID].FastPass;
                                    } else {
                                        // ride isn't on the website. Most like park is closed, so set wait time to -1 to mark as inactive
                                        rideObject.WaitTime = -1;
                                    }
                                }
                            }

                            resolve();
                        }.bind(this));
                }.bind(this), reject);
            }.bind(this), reject);
        }.bind(this));
    }

    FetchOpeningTimes() {
        return new Promise(function(resolve, reject) {
            // fetch 3 months of schedule data
            var today = Moment().tz(this.Timezone);
            this.FetchOpeningTimesForMonth(today.format("YYYYMM")).then(function() {
                today.add(1, "month");
                this.FetchOpeningTimesForMonth(today.format("YYYYMM")).then(function() {
                    today.add(1, "month");
                    this.FetchOpeningTimesForMonth(today.format("YYYYMM")).then(function() {
                        resolve();
                    }.bind(this), reject);
                }.bind(this), reject);
            }.bind(this), reject);
        }.bind(this));
    }

    FetchOpeningTimesForMonth(month) {
        return new Promise(function(resolve, reject) {
            this.HTTP({
                url: `http://www.tokyodisneyresort.jp/api/v1/wapi_monthlycalendars/detail/ym:${month}/`,
                headers: {
                    "Referer": `http://www.tokyodisneyresort.jp/en/attraction/lists/park:${this[s_parkID]}`,
                    "X-Requested-With": "XMLHttpRequest"
                },
                forceJSON: true
            }).then(function(body) {
                if (!body || !body.entry) return reject("Failed to find data from TDR calendar");

                for (var date in body.entry) {
                    if (body.entry[date][this[s_parkID]]) {
                        var scheduleDate = Moment(date, "YYYY/MM/DD");
                        this.Schedule.SetDate({
                            date: scheduleDate,
                            openingTime: Moment.tz(scheduleDate.format("YYYY-MM-DD") + " " + body.entry[date][this[s_parkID]].open_time_1, "YYYY-MM-DD HH:mm", this.Timezone),
                            closingTime: Moment.tz(scheduleDate.format("YYYY-MM-DD") + " " + body.entry[date][this[s_parkID]].close_time_1, "YYYY-MM-DD HH:mm", this.Timezone),
                        });
                    }
                }

                resolve();
            }.bind(this), reject);
        }.bind(this));
    }

    /**
     * Get the Geo-Locked access token for accessing Tokyo Disneyland wait times
     * @returns {Promise<String>} tdrloc cookie needed for accessing wait time pages
     */
    GetAcccessToken() {
        var cookieExpire;
        return this.Cache.Wrap("geocookie", function() {
            return new Promise(function(resolve, reject) {
                // generate a new geo cookie for accessing Tokyo ride data
                var randomGeoLocation = GeoLocation.RandomBetween(this[s_parkLocationMin], this[s_parkLocationMax]);

                // request cookie for accessing wait times using a random location in the park
                this.HTTP({
                    url: `http://info.tokyodisneyresort.jp/s/gps/${this[s_parkID]}_index.html`,
                    data: {
                        nextUrl: `http://info.tokyodisneyresort.jp/rt/s/realtime/${this[s_parkID]}_attraction.html`,
                        lat: randomGeoLocation.LatitudeRaw,
                        lng: randomGeoLocation.LongitudeRaw
                    },
                    headers: {
                        "Referer": `http://www.tokyodisneyresort.jp/en/attraction/lists/park:${this[s_parkID]}`,
                    },
                    // don't actually follow the redirect, we just want the cookie
                    follow_max: 0,
                    // we are actually only interested in the headers, so get the full response, not the body
                    returnFullResponse: true
                }).then(function(resp) {
                    if (resp && resp.headers && resp.headers["set-cookie"] && resp.headers["set-cookie"].length) {
                        // hunt for the tdrloc cookie
                        var GPSCookie, GPSExpiresIn = 60 * 30;
                        for (var i = 0, cookie_string; cookie_string = resp.headers["set-cookie"][i++];) {
                            var cookie_data = cookie.parse(cookie_string);

                            // search for any tdrloc cookie
                            //  keep searching and keep the last set one
                            //  their server usually sets it twice, first deleting it, then setting the correct one
                            if (cookie_data && cookie_data.tdrloc) {
                                GPSCookie = cookie_data.tdrloc;
                                // parse cookie date to calculate expirey time in seconds
                                GPSExpiresIn = Moment().diff(Moment(cookie_data.expires, "ddd, DD-MMM-YYYY HH:mm:ss z"), "seconds");

                                // the cookie can actually be negative if the park is closed (weird, but OK)
                                //  if this is so, keep the current one for 5 minutes and try again
                                if (GPSExpiresIn < 0) {
                                    GPSExpiresIn = 60 * 5;
                                }
                            }
                        }

                        // did we find the cookie?
                        if (GPSCookie) {
                            // set out-of-scope cookieExpire so we can tell the cache how long to keep this token
                            //  take a little off to be safe (a minute)
                            cookieExpire = GPSExpiresIn - 60;

                            this.Log(`Fetched new TDR geo-cookie: ${GPSCookie}`);

                            // return the new cookie
                            resolve(GPSCookie);
                        } else {
                            return reject("Failed to find GPS Cookie from TDR website");
                        }
                    } else {
                        return reject("Missing GeoCookie from TDR response");
                    }
                }.bind(this), reject);
            }.bind(this));
        }.bind(this), function() {
            return cookieExpire;
        }.bind(this));
    }

    /**
     * Fetch English ride names from the API
     * @returns {Promise<Object>} `rideID` to English names
     */
    GetRideNames() {
        return this.Cache.Wrap("ridenames", function() {
            return new Promise(function(resolve, reject) {
                // fetch ride names
                this.HTTP({
                    url: `http://www.tokyodisneyresort.jp/api/v1/wapi_attractions/lists/sort_type:1/locale:1/park_kind:${this[s_parkKind]}/`,
                    forceJSON: true,
                    headers: {
                        "Referer": `http://www.tokyodisneyresort.jp/en/attraction/lists/park:${this[s_parkID]}`,
                    },
                }).then(function(body) {
                    if (!body || !body.entries || !body.entries.length) {
                        return reject("Failed to find entries in ride data response");
                    }

                    // populate data
                    var rideData = {};
                    for (var i = 0, ride; ride = body.entries[i++];) {
                        // use English if we can, fallback to yomi if we're missing an English name
                        rideData[ride.str_id] = ride.name || ride.name_yomi;
                    }

                    return resolve(rideData);
                }.bind(this), reject);
            }.bind(this));
        }.bind(this), 86400);
    }
}

module.exports = DisneyTokyoPark;