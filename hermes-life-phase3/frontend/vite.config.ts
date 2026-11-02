import { defineConfig } from 'vite';
export default defineConfig({server:{port:5173,strictPort:true,proxy:{'/api':'http://127.0.0.1:8766','/health':'http://127.0.0.1:8766','/ws':{target:'ws://127.0.0.1:8766',ws:true}}}});
