---
name: react-nextjs-patterns
description: Best practices for React 19 and Next.js 15 (App Router) development
---

# React/Next.js Development Patterns

## Project Structure (App Router)
```
app/
  layout.tsx          # Root layout (required)
  page.tsx            # Home page
  globals.css         # Global styles
  (routes)/           # Route groups
  api/                # API routes
components/
  ui/                 # Reusable UI components
  forms/              # Form components
lib/
  utils.ts            # Utility functions
  hooks/              # Custom hooks
types/
  index.ts            # Shared TypeScript types
```

## Key Patterns

### Client Components
```tsx
"use client";
import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

### Server Components (Default)
```tsx
// No "use client" - runs on server
import { db } from "@/lib/db";

export default async function Page() {
  const posts = await db.post.findMany();
  return <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>;
}
```

### Data Fetching
```tsx
// Parallel data fetching
const [users, posts] = await Promise.all([
  fetch("/api/users").then(r => r.json()),
  fetch("/api/posts").then(r => r.json()),
]);

// Static generation (default)
export const revalidate = 3600; // ISR
```

### Server Actions
```tsx
"use server";

export async function createPost(formData: FormData) {
  const title = formData.get("title");
  await db.post.create({ data: { title } });
  revalidatePath("/posts");
}
```

## TypeScript Patterns
- Use `@/*` path alias (configured in tsconfig.json)
- Prefer `interface` for props, `type` for unions
- Use `React.FC` sparingly; prefer function components

## Styling (Tailwind CSS)
```tsx
<div className="flex items-center gap-4 p-4 bg-zinc-900 rounded-lg">
  <Button className="bg-blue-600 hover:bg-blue-700">Click</Button>
</div>
```

## Common Pitfalls
1. **Forgetting "use client"** - Interactive components need it
2. **Server component imports** - Can't import client components directly in server components without dynamic import
3. **Hydration mismatches** - Ensure server/client render same output
4. **next/image** - Use for optimized images, not `<img>`
4. **Route handlers** - Use `export async function GET/POST` in `route.ts`

## Testing
- Unit: Vitest + React Testing Library
- E2E: Playwright (configured in templates)

## Performance
- Use `React.memo`, `useMemo`, `useCallback` sparingly
- Prefer server components for data fetching
- Use `next/font` for fonts
- Enable `images.loader` for custom image domains
