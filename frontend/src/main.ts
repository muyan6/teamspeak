import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
// 按需引入：源码中只使用 fill / bold / duotone 三种字重，引入 regular 只会
// 白白增加约 130 KB 的字体与对应 CSS（vendor-icons 曾是构建产物中最大的 CSS）。
import '@phosphor-icons/web/bold';
import '@phosphor-icons/web/fill';
import '@phosphor-icons/web/duotone';
import './style.css';

import HomeView from './views/HomeView.vue';
import ProfileView from './views/ProfileView.vue';
import AdminModal from './components/AdminModal.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/profile', name: 'profile', component: ProfileView },
    { path: '/admin', name: 'admin', component: AdminModal },
  ],
});

createApp(App).use(router).mount('#app');
