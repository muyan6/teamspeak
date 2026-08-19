import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
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
