# --- Base Stage ---
    FROM node:22-alpine AS base
    WORKDIR /app
    
    # Install pnpm
    RUN corepack enable && corepack prepare pnpm@latest --activate
    
    # Copy only package files to install dependencies
    COPY pnpm-lock.yaml package.json ./
    
    # --- Dependencies Stage ---
    FROM base AS deps
    RUN pnpm install --frozen-lockfile
    
    # --- Build Stage ---
    FROM deps AS build
    COPY . .
    RUN pnpm build
    
    # --- Production Stage ---
    FROM node:22-alpine AS prod
    WORKDIR /app
    
    # Enable pnpm and copy necessary files
    RUN corepack enable && corepack prepare pnpm@latest --activate
    COPY --from=deps /app/node_modules ./node_modules
    COPY --from=build /app/dist ./dist
    COPY package.json .
    
    CMD ["node", "dist/app.js"]
    