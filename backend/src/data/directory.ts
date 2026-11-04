import fs from "node:fs";
import path from "node:path";
import { BACKEND_ROOT } from "../config.js";

export interface Business {
  id: string;
  name: string;
  city: string;
  category: string;
  neighborhood: string;
  description: string;
  priceLevel: number;
  rating: number;
  tags: string[];
  slowHours: string;
  contact: string;
  website: string;
  fictional?: boolean;
}

/** Mock local-business directory (fictional; stands in for Google Places / Yelp in the demo). */
export const BUSINESSES: Business[] = JSON.parse(
  fs.readFileSync(path.join(BACKEND_ROOT, "src/data/businesses.json"), "utf8"),
);

export const CITIES = [...new Set(BUSINESSES.map((b) => b.city))];
export const BUSINESS_CATEGORIES = [...new Set(BUSINESSES.map((b) => b.category))];
