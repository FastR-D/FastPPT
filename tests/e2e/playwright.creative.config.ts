import { defineConfig } from '@playwright/test'
export default defineConfig({testDir:'./specs',testMatch:'creative-animation.spec.ts',timeout:120_000,expect:{timeout:15_000},workers:1,reporter:'line',use:{baseURL:'http://127.0.0.1:4318',viewport:{width:1440,height:1000},launchOptions:{executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']}}})
