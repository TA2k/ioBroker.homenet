"use strict";

/*
 * Created with @iobroker/create-adapter v2.3.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const axios = require("axios").default;
const qs = require("qs");
const Json2iob = require("./lib/json2iob");

// Load your modules here, e.g.:
// const fs = require("fs");

class Homenet extends utils.Adapter {
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  constructor(options) {
    super({
      ...options,
      name: "homenet",
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.deviceArray = [];

    this.json2iob = new Json2iob(this);
    this.requestClient = axios.create();
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    // Reset the connection indicator during startup
    this.setState("info.connection", false, true);
    if (this.config.interval < 0.5) {
      this.log.info("Set interval to minimum 0.5");
      this.config.interval = 0.5;
    }
    if (!this.config.username || !this.config.password) {
      this.log.error("Please set username and password in the instance settings");
      return;
    }

    this.updateInterval = null;
    this.reLoginTimeout = null;
    this.refreshTokenTimeout = null;
    this.session = {};
    this.subscribeStates("*");

    this.log.info("Login to eBike Connect");
    await this.login();
    if (this.session.access_token) {
      await this.getDeviceList();
      await this.updateDevices();
      this.updateInterval = setInterval(async () => {
        await this.updateDevices();
      }, this.config.interval * 60 * 1000);
    }
    this.refreshTokenInterval = setInterval(() => {
      this.refreshToken();
    }, this.session.expires_in * 1000);
  }
  async login() {
    await this.requestClient({
      method: "post",
      url: "https://prod-api.whrcloud.eu/oauth/token",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "*/*",
        "wp-client-appname": "BAUKNECHT",
        "wp-client-platform": "IOS",
        "wp-client-region": "EMEA",
        "accept-language": "de-DE;q=1.0, uk-DE;q=0.9, en-DE;q=0.8",
        "wp-client-country": "DE",
        "wp-client-language": "ger",
        "application-brand": "BAUKNECHT",
        "user-agent": "BKT - Store/6.3.0 (com.bauknecht.blive; build:6.3.0.1; iOS 14.8.0) Alamofire/5.5.0",
        "wp-client-brand": "BAUKNECHT",
      },
      data:
        "client_id=bauknecht_ios_emea&client_secret=zdiScmLWIcTJM8eIXfIzKvaMNI5l7c85kUs-piFGBUv3GnkFQLCmXgF9AsRpaQXSgcC4iknrl3sh7UrTzGpQStv0z1MuOoindzAmMxnWP2FJssrAcsQolTLP6Kz0rnrPp3Z2d8btNuPy0wUkRYZv4oYSMMEm4YtpwTj_lBdVzVgQMUd-phY18E__v4wK44TE4EUpiWodTjrUq5yF8i9KInHUfhazC_pvQ0PZGnF70P7uhQbmVs3mLb0GmhR17mFC_nwitLJVl_OMFgg_IIPF79YRoCVmnkZeZ8rjp7ogrOT4UdgU3bQk0KFlRtHVU3kvJRH7wwVGFto0DsVtOgki7g&grant_type=password&password=" +
        this.config.password +
        "&username=" +
        this.config.username +
        "&wp-client-brand=BAUKNECHT&wp-client-region=EMEA",
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        this.setState("info.connection", true, true);
        this.session = res.data;
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
  }

  async getDeviceList() {
    await this.requestClient({
      method: "get",
      url: "https://prod-api.whrcloud.eu/api/v2/appliance/all/account/" + this.session.accountId,
      headers: {
        Host: "prod-api.whrcloud.eu",
        "content-type": "application/json",
        authorization: "Bearer " + this.session.access_token,
        accept: "*/*",
        "wp-client-appname": "BAUKNECHT",
        "wp-client-platform": "IOS",
        "wp-client-region": "EMEA",
        "accept-language": "de-DE;q=1.0, uk-DE;q=0.9, en-DE;q=0.8",
        "wp-client-country": "DE",
        "wp-client-language": "ger",
        "application-brand": "BAUKNECHT",
        "user-agent": "BKT - Store/6.3.0 (com.bauknecht.blive; build:6.3.0.1; iOS 14.8.0) Alamofire/5.5.0",
        "wp-client-brand": "BAUKNECHT",
      },
    })
      .then(async (res) => {
        this.log.debug(JSON.stringify(res.data));
        //this.log.info(`Found ${res.data} devices`);
        for (const device of res.data) {
          const id = device.applianceId;

          this.deviceArray.push(id);
          const name = device.name;

          await this.setObjectNotExistsAsync(id, {
            type: "device",
            common: {
              name: name,
            },
            native: {},
          });
          await this.setObjectNotExistsAsync(id + ".remote", {
            type: "channel",
            common: {
              name: "Remote Controls",
            },
            native: {},
          });

          const remoteArray = [{ command: "Refresh", name: "True = Refresh" }];
          remoteArray.forEach((remote) => {
            this.setObjectNotExists(id + ".remote." + remote.command, {
              type: "state",
              common: {
                name: remote.name || "",
                type: remote.type || "boolean",
                role: remote.role || "boolean",
                def: remote.def || false,
                write: true,
                read: true,
              },
              native: {},
            });
          });
          this.json2iob.parse(id, device, { forceIndex: true });
        }
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
  }

  async updateDevices() {
    const statusArray = [];

    for (const element of statusArray) {
      // const url = element.url.replace("$id", id);

      await this.requestClient({
        method: element.method || "get",
        url: element.url,
      })
        .then(async (res) => {
          this.log.debug(JSON.stringify(res.data));
          if (!res.data) {
            return;
          }
          const data = res.data;

          const forceIndex = true;
          const preferedArrayName = null;

          this.json2iob.parse(element.path, data, {
            forceIndex: forceIndex,
            preferedArrayName: preferedArrayName,
            channelName: element.desc,
          });
          await this.setObjectNotExistsAsync(element.path + ".json", {
            type: "state",
            common: {
              name: "Raw JSON",
              write: false,
              read: true,
              type: "string",
              role: "json",
            },
            native: {},
          });
          this.setState(element.path + ".json", JSON.stringify(data), true);
        })
        .catch((error) => {
          if (error.response) {
            if (error.response.status === 401) {
              error.response && this.log.debug(JSON.stringify(error.response.data));
              this.log.info(element.path + " receive 401 error. Refresh Token in 60 seconds");
              this.refreshTokenTimeout && clearTimeout(this.refreshTokenTimeout);
              this.refreshTokenTimeout = setTimeout(() => {
                this.refreshToken();
              }, 1000 * 60);

              return;
            }
          }
          this.log.error(element.url);
          this.log.error(error);
          error.response && this.log.error(JSON.stringify(error.response.data));
        });
    }
  }

  async refreshToken() {
    this.log.debug("Refresh token");

    await this.requestClient({
      method: "post",
      url: "https://prod-api.whrcloud.eu/oauth/token",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "*/*",
        "wp-client-appname": "BAUKNECHT",
        "wp-client-platform": "IOS",
        "wp-client-region": "EMEA",
        "accept-language": "de-DE;q=1.0, uk-DE;q=0.9, en-DE;q=0.8",
        "wp-client-country": "DE",
        "wp-client-language": "ger",
        "application-brand": "BAUKNECHT",
        "user-agent": "BKT - Store/6.3.0 (com.bauknecht.blive; build:6.3.0.1; iOS 14.8.0) Alamofire/5.5.0",
        "wp-client-brand": "BAUKNECHT",
      },
      data:
        "client_id=bauknecht_ios_emea&client_secret=zdiScmLWIcTJM8eIXfIzKvaMNI5l7c85kUs-piFGBUv3GnkFQLCmXgF9AsRpaQXSgcC4iknrl3sh7UrTzGpQStv0z1MuOoindzAmMxnWP2FJssrAcsQolTLP6Kz0rnrPp3Z2d8btNuPy0wUkRYZv4oYSMMEm4YtpwTj_lBdVzVgQMUd-phY18E__v4wK44TE4EUpiWodTjrUq5yF8i9KInHUfhazC_pvQ0PZGnF70P7uhQbmVs3mLb0GmhR17mFC_nwitLJVl_OMFgg_IIPF79YRoCVmnkZeZ8rjp7ogrOT4UdgU3bQk0KFlRtHVU3kvJRH7wwVGFto0DsVtOgki7g&grant_type=refresh_token&refresh_token=" +
        +this.session.refresh_token +
        "&wp-client-brand=BAUKNECHT&wp-client-region=EMEA",
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        this.session = res.data;
        this.log.debug("Refresh successful");
        this.setState("info.connection", true, true);
      })
      .catch(async (error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
        this.setStateAsync("info.connection", false, true);
      });
  }

  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   * @param {() => void} callback
   */
  onUnload(callback) {
    try {
      this.setState("info.connection", false, true);
      this.refreshTimeout && clearTimeout(this.refreshTimeout);
      this.reLoginTimeout && clearTimeout(this.reLoginTimeout);
      this.refreshTokenTimeout && clearTimeout(this.refreshTokenTimeout);
      this.updateInterval && clearInterval(this.updateInterval);
      this.refreshTokenInterval && clearInterval(this.refreshTokenInterval);
      callback();
    } catch (e) {
      callback();
    }
  }

  /**
   * Is called if a subscribed state changes
   * @param {string} id
   * @param {ioBroker.State | null | undefined} state
   */
  async onStateChange(id, state) {
    if (state) {
      if (!state.ack) {
        const deviceId = id.split(".")[2];
        const command = id.split(".")[4];
        if (id.split(".")[3] !== "remote") {
          return;
        }

        if (command === "Refresh") {
          this.updateDevices();
          return;
        }
      }
    }
  }
}

if (require.main !== module) {
  // Export the constructor in compact mode
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  module.exports = (options) => new Homenet(options);
} else {
  // otherwise start the instance directly
  new Homenet();
}
