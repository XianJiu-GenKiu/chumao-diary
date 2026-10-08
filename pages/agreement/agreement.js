const app = getApp()

Page({
  data: {
    darkMode: false
  },

  onLoad() {
    this.setData({ darkMode: app.globalData.darkMode || false })
  }
})
