FROM node:20-alpine

WORKDIR /app

# Copy collector package descriptors from services/whatsapp-collector
COPY services/whatsapp-collector/package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy collector source code
COPY services/whatsapp-collector/ ./

# Expose default HTTP health-check port
EXPOSE 10000

ENV PORT=10000

CMD ["npm", "start"]
