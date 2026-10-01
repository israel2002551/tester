FROM node:20-alpine

WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose default HTTP health-check port
EXPOSE 10000

ENV PORT=10000

CMD ["npm", "start"]
