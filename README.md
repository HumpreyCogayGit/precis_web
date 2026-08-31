# Precis Web Application

This is a React web application that displays news blog items from the Precis Scraper database.

## Requirements

- Node.js 24.x for Vercel deployment. The app should also be tested locally on newer Node releases such as Node 26 before switching production when Vercel supports them.
- PostgreSQL database with the scraper schema from `blogscraper.storage.Storage`

## Setup Instructions

1. **Install dependencies for API server:**
   ```bash
   cd precis_web
   npm install
   ```

2. **Start the API server:**
   ```bash
   cp .env.example .env
   # edit .env and set DATABASE_URL if your DB is not the local Precis_Scraper database
   npm start
   ```
   
   This will start the server on http://localhost:5000

3. **In a separate terminal, start the Vite React application:**
   ```bash
   cd precis_web/react-app
   npm install
   npm start
   ```

   This will start the React app on http://localhost:5173

## API Endpoints

- `GET /api/health` - Check API/database health and active Node runtime
- `GET /api/articles` - Get articles, optionally filtered/paginated with `?topic=...&limit=50&offset=0`
- `GET /api/articles/:site` - Get articles from specific site, optionally filtered/paginated with `?topic=...&limit=50&offset=0`
- `GET /api/sites` - Get list of all available sites
- `GET /api/topics` - Get list of all available topics
- `GET /api/image-proxy?url=...` - Proxy remote article images for browser display

## Features

- Responsive grid layout for displaying blog articles
- Filter by source website
- Displays title, author, publish date, and article excerpt
- Clean modern UI with hover effects and proper spacing

## Notes

The local API and Vercel Serverless Functions read from `DATABASE_URL` or `POSTGRES_URL`.
If neither is set, local development falls back to `postgresql://localhost:5432/Precis_Scraper`.

The frontend uses Vite. Set `VITE_API_BASE_URL` only when you need the browser to call a separate API origin; leave it unset on Vercel for same-origin `/api/*` calls.

For production deployment details, including how to keep the scraper local while hosting the site and database, see `DEPLOYMENT.md`.