<script>
export default {
  onLaunch() {
    console.log('出毛地图 App Launch')
    this.initApp()
  },
  onShow() {
    console.log('出毛地图 App Show')
  },
  onHide() {
    console.log('出毛地图 App Hide')
  },
  methods: {
    initApp() {
      // 检查登录状态
      const token = uni.getStorageSync('token')
      if (!token) {
        // 生成临时用户ID
        const tempUserId = 'user_' + Date.now()
        uni.setStorageSync('userId', tempUserId)
      }

      // 初始化分类数据
      this.initCategories()
    },
    initCategories() {
      const categories = [
        { id: 'food', name: '美食', icon: 'food', color: '#FF6B4A' },
        { id: 'scenery', name: '风景', icon: 'scenery', color: '#00B894' },
        { id: 'entertainment', name: '娱乐', icon: 'entertainment', color: '#9B59B6' },
        { id: 'hotel', name: '住宿', icon: 'hotel', color: '#3498DB' },
        { id: 'shopping', name: '购物', icon: 'shopping', color: '#F39C12' },
        { id: 'other', name: '其他', icon: 'other', color: '#95A5A6' }
      ]
      if (!uni.getStorageSync('categories')) {
        uni.setStorageSync('categories', categories)
      }
    }
  }
}
</script>

<style lang="scss">
@import "styles/main.scss";
@import "static/iconfont.css";
</style>
