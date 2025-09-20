# Dockerfile for a11y-site-scanner
FROM node:18-bullseye

# Install app dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

# Install Playwright Chromium and OS deps
RUN npx playwright install --with-deps chromium

# Add source
COPY server.js ./

EXPOSE 3000
CMD ["npm", "start"]
