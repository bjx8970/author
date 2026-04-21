# ============================================
#  Author App — Docker 多阶段构建
# ============================================
#  用法:
#    docker compose up -d          # 启动
#    docker compose down           # 停止
#    docker compose up -d --build  # 重新构建
# ============================================

# ---- 阶段1: 安装依赖 ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY .npmrc* package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---- 阶段2: 构建 ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY .npmrc* package.json package-lock.json* ./
RUN npm ci
COPY . .

# Supabase 环境变量（构建时注入，用于云同步功能）
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN npm run build

# ---- 阶段3: 生产运行 ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"

# 从构建产物复制 standalone + static + public
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# 创建数据持久化目录
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME /app/data

USER node

EXPOSE 3000

CMD ["node", "server.js"]
