const app = getApp()
const { VERSION, APP_NAME, CONTACT_EMAIL, CONTACT_WECHAT, ICP_LICENSE } = require('../../config/app-info')

Page({
  data: {
    darkMode: false,
    appName: APP_NAME,
    appVersion: VERSION,
    contactEmail: CONTACT_EMAIL,
    contactWechat: CONTACT_WECHAT,
    icpLicense: ICP_LICENSE
  },

  onLoad() {
    this.setData({ darkMode: app.globalData.darkMode || false })
  }
})
