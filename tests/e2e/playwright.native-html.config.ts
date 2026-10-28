import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir:'./specs',testMatch:'native-html.spec.ts',timeout:90_000,workers:1,reporter:'line',
  use:{baseURL:'http://127.0.0.1:4318',viewport:{width:1200,height:800},launchOptions:{executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']}},
})
