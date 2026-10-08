Component({ properties: { message: { type: String, value: '加载失败，请检查网络后重试' }, visible: { type: Boolean, value: false } }, methods: { retry() { this.triggerEvent('retry') } } })
