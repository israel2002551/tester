FROM node:20-slim
WORKDIR /app
COPY package*.json ./
# npm runs postinstall during dependency installation; copy that script first.
COPY scripts ./scripts
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
