const app = getApp()
const { VERSION, APP_NAME, CONTACT_EMAIL, CONTACT_WECHAT } = require('../../config/app-info')

Page({
  data: {
    darkMode: false,
    appName: APP_NAME,
    appVersion: VERSION,
    contactEmail: CONTACT_EMAIL,
    contactWechat: CONTACT_WECHAT
  },

  onLoad() {
    this.setData({ darkMode: app.globalData.darkMode || false })
  }
})
