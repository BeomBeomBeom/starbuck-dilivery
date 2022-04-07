
import Vue from 'vue'
import Router from 'vue-router'

Vue.use(Router);


import OrderManager from "./components/OrderManager"

import OrderStatus from "./components/OrderStatus"
import Menu from "./components/Menu"
import PayManager from "./components/PayManager"

import DeliveryManager from "./components/DeliveryManager"

export default new Router({
    // mode: 'history',
    base: process.env.BASE_URL,
    routes: [
            {
                path: '/orders',
                name: 'OrderManager',
                component: OrderManager
            },

            {
                path: '/orderStatuses',
                name: 'OrderStatus',
                component: OrderStatus
            },
            {
                path: '/menus',
                name: 'Menu',
                component: Menu
            },
            {
                path: '/pays',
                name: 'PayManager',
                component: PayManager
            },

            {
                path: '/deliveries',
                name: 'DeliveryManager',
                component: DeliveryManager
            },



    ]
})
