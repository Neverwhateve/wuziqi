FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY server ./server
RUN cd server && npm install

COPY client ./client
RUN cd client && npm install && npm run build && cd ..

RUN node -e "const fs=require('fs');const path=require('path');const src=path.join(__dirname,'client','dist');const dest=path.join(__dirname,'server','public');if(fs.existsSync(dest))fs.rmSync(dest,{recursive:true});fs.cpSync(src,dest,{recursive:true});"

EXPOSE 8080

CMD ["node", "server/index.js"]