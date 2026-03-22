FROM node:20-alpine

WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application code
COPY . .

# The app typically binds to port 3000 (adjust if different)
EXPOSE 3000

# Start the application using the start script in package.json
CMD ["npm", "start"]
