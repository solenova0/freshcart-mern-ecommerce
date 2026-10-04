import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDatabase } from '../config/db.js'
import Category from '../models/Category.js'
import Product from '../models/Product.js'

export const seedCategories = [
  { name: 'Groceries', slug: 'groceries', description: 'Everyday fresh produce and pantry essentials.' },
  { name: 'Hookah Accessories', slug: 'hookah-accessories', description: 'Hookah equipment and replacement accessories.' },
]

const groceries = [
  ['Apples', 2.5, { unit: 'kg', organic: true }],
  ['Bananas', 1.8, { unit: 'kg' }],
  ['Oranges', 3.2, { unit: 'kg' }],
  ['Tomatoes', 2.1, { unit: 'kg' }],
  ['Potatoes', 1.5, { unit: 'kg' }],
  ['Carrots', 1.9, { unit: 'kg' }],
  ['Milk', 2.4, { volumeMl: 1000, refrigerated: true }],
  ['Eggs', 4.5, { packSize: 12 }],
  ['Rice', 5.5, { weightKg: 2 }],
  ['Bread', 2.8, { weightGrams: 500 }],
]
const accessories = [
  ['Glass Hookah', 65, { material: 'glass', heightCm: 45 }],
  ['Ceramic Bowl', 12, { material: 'ceramic' }],
  ['Silicone Hose', 15, { material: 'silicone', lengthCm: 150 }],
  ['Mouthpiece Pack', 6, { packSize: 10 }],
  ['Hookah Tongs', 8, { material: 'steel' }],
  ['Cleaning Brush', 5, { lengthCm: 40 }],
  ['Travel Case', 25, { material: 'fabric' }],
  ['Diffuser', 7, { material: 'silicone' }],
  ['Bowl Grommet', 3, { material: 'silicone' }],
  ['Heat Management Device', 30, { material: 'aluminum' }],
]

export const seedProducts = [
  ...groceries.map(([name, price, attributes]) => ({
    name, price, attributes, description: `Sample ${name.toLowerCase()} for the FreshCart grocery catalog.`,
    stock: 50, productType: 'grocery', categorySlug: 'groceries',
  })),
  ...accessories.map(([name, price, attributes]) => ({
    name, price, attributes, description: `Sample ${name.toLowerCase()} for the FreshCart accessories catalog.`,
    stock: 15, productType: 'hookah', categorySlug: 'hookah-accessories',
  })),
]

export async function seedCatalog({ CategoryModel = Category, ProductModel = Product } = {}) {
  await Promise.all([CategoryModel.init(), ProductModel.init()])
  const categories = new Map()
  for (const values of seedCategories) {
    const category = await CategoryModel.findOneAndUpdate({ slug: values.slug }, { $setOnInsert: values }, {
      upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true,
    })
    categories.set(values.slug, category._id)
  }

  let insertedProducts = 0
  for (const sample of seedProducts) {
    const { categorySlug, ...values } = sample
    const stableId = createHash('sha256').update(`freshcart-seed:${categorySlug}:${values.name}`).digest('hex').slice(0, 24)
    const result = await ProductModel.updateOne({ _id: new mongoose.Types.ObjectId(stableId) }, {
      $setOnInsert: { ...values, category: categories.get(categorySlug) },
    }, { upsert: true, runValidators: true, setDefaultsOnInsert: true })
    insertedProducts += result.upsertedCount || 0
  }
  return { categories: seedCategories.length, products: seedProducts.length, insertedProducts }
}

async function main() {
  dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })
  const uri = process.env.MONGODB_URI?.trim()
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error('A valid MONGODB_URI is required')
  try {
    await connectDatabase(uri)
    const result = await seedCatalog()
    console.log(`Seed checked ${result.categories} categories and ${result.products} sample products; inserted ${result.insertedProducts} products.`)
  } finally {
    await mongoose.disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Catalog seed failed. Check MONGODB_URI, database availability, and existing indexes.')
    process.exitCode = 1
  })
}