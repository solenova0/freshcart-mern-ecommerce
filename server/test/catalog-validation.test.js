import assert from 'node:assert/strict'
import { test } from 'node:test'
import Product from '../src/models/Product.js'
import Category from '../src/models/Category.js'
import { seedCatalog, seedCategories, seedProducts } from '../src/scripts/seed.js'
import {
  buildProductQuery, createCategorySchema, createProductSchema, idSchema,
  productListSchema, updateCategorySchema, updateProductSchema,
} from '../src/catalog/validation.js'

const categoryId = 'a'.repeat(24)

test('catalog creation validates values and defaults without allowing image ownership fields', () => {
  const category = createCategorySchema.parse({ name: ' Groceries ', slug: ' GROCERIES ' })
  assert.deepEqual(category, { name: 'Groceries', slug: 'groceries', description: '' })
  const product = createProductSchema.parse({ name: ' Apples ', price: 2.5, category: categoryId })
  assert.deepEqual(product, { name: 'Apples', price: 2.5, category: categoryId, description: '', stock: 0, productType: 'grocery', attributes: {} })
  for (const values of [{ price: -1 }, { stock: 1.5 }, { category: 'invalid' }, { attributes: [] }, { images: ['https://example.com/photo.jpg'] }, { imageAssets: [] }]) {
    assert.equal(createProductSchema.safeParse({ name: 'Apples', price: 2.5, category: categoryId, ...values }).success, false)
  }
  assert.equal(createCategorySchema.safeParse({ name: 'Groceries', slug: 'groceries', imagePublicId: 'someone-elses-image' }).success, false)
})

test('partial updates do not inject defaults or overwrite omitted fields', () => {
  assert.deepEqual(updateProductSchema.parse({ price: 3 }), { price: 3 })
  assert.deepEqual(updateCategorySchema.parse({ name: 'New name' }), { name: 'New name' })
  assert.equal(updateProductSchema.safeParse({}).success, false)
  assert.equal(updateCategorySchema.safeParse({}).success, false)
  assert.equal(updateProductSchema.safeParse({ __v: 1 }).success, false)
})

test('public queries build bounded pagination, text search, category filtering, and stable price sorting', () => {
  const query = productListSchema.parse({ search: ' apples ', category: categoryId, sort: 'price_asc', page: '2', limit: '10' })
  assert.deepEqual(buildProductQuery(query), {
    filter: { $text: { $search: 'apples' }, category: categoryId },
    sort: { price: 1, _id: 1 }, skip: 10, limit: 10,
  })
  assert.deepEqual(buildProductQuery(productListSchema.parse({})).sort, { createdAt: -1, _id: -1 })
  assert.deepEqual(buildProductQuery(productListSchema.parse({ search: 'apples' })).sort, { score: { $meta: 'textScore' }, _id: 1 })
  assert.deepEqual(buildProductQuery(productListSchema.parse({ sort: 'price_desc', productType: 'hookah' })).filter, { productType: 'hookah' })
})

test('invalid catalog IDs, pagination, operator-shaped inputs, and sorts are rejected', () => {
  assert.equal(idSchema.safeParse({ id: 'invalid' }).success, false)
  for (const query of [{ page: '0' }, { page: '1.5' }, { page: ['1'] }, { page: '10001' }, { limit: '51' }, { limit: '-1' }, { category: { $ne: '' } }, { sort: 'unexpected' }, { sort: 'relevance' }, { search: '' }]) {
    assert.equal(productListSchema.safeParse(query).success, false)
  }
})

test('Cloudinary identifiers are hidden in public catalog JSON and writes use optimistic concurrency', () => {
  const product = new Product({
    name: 'Apples', price: 2.5, category: categoryId, images: ['https://example.com/apples.jpg'],
    imageAssets: [{ url: 'https://example.com/apples.jpg', publicId: 'freshcart/products/apples' }],
  })
  const category = new Category({ name: 'Groceries', slug: 'groceries', imagePublicId: 'freshcart/categories/groceries' })
  assert.equal(product.toJSON().imageAssets, undefined)
  assert.equal(category.toJSON().imagePublicId, undefined)
  assert.equal(Product.schema.path('imageAssets').options.select, false)
  assert.equal(Category.schema.path('imagePublicId').options.select, false)
  assert.equal(Product.schema.options.optimisticConcurrency, true)
  assert.equal(Category.schema.options.optimisticConcurrency, true)
})

test('seed contains two valid categories and twenty valid products split between grocery and hookah', async () => {
  assert.equal(seedCategories.length, 2)
  assert.equal(seedProducts.length, 20)
  assert.equal(seedProducts.filter((product) => product.productType === 'grocery').length, 10)
  assert.equal(seedProducts.filter((product) => product.productType === 'hookah').length, 10)
  for (const values of seedCategories) await new Category(values).validate()
  for (const { categorySlug, ...values } of seedProducts) {
    assert.ok(seedCategories.some((category) => category.slug === categorySlug))
    await new Product({ ...values, category: categoryId }).validate()
  }
})

test('seed upserts are repeatable and preserve existing product edits and uploads', async () => {
  const categories = new Map()
  const products = new Map()
  const models = {
    CategoryModel: {
      async init() {},
      async findOneAndUpdate(filter, update, options) {
        assert.equal(options.upsert, true)
        assert.equal(options.new, true)
        assert.equal(options.runValidators, true)
        if (!categories.has(filter.slug)) categories.set(filter.slug, new Category(update.$setOnInsert))
        return categories.get(filter.slug)
      },
    },
    ProductModel: {
      async init() {},
      async updateOne(filter, update, options) {
        assert.equal(options.upsert, true)
        assert.equal(options.runValidators, true)
        assert.deepEqual(Object.keys(update), ['$setOnInsert'])
        const key = filter._id.toString()
        if (products.has(key)) return { upsertedCount: 0 }
        const product = new Product({ _id: filter._id, ...update.$setOnInsert })
        await product.validate()
        products.set(key, product)
        return { upsertedCount: 1 }
      },
    },
  }
  assert.deepEqual(await seedCatalog(models), { categories: 2, products: 20, insertedProducts: 20 })
  const first = [...products.values()][0]
  first.price = 99
  first.stock = 777
  first.images = ['https://example.com/custom.png']
  first.imageAssets = [{ url: first.images[0], publicId: 'owned-custom-image' }]
  assert.deepEqual(await seedCatalog(models), { categories: 2, products: 20, insertedProducts: 0 })
  assert.equal(categories.size, 2)
  assert.equal(products.size, 20)
  assert.equal(first.price, 99)
  assert.equal(first.stock, 777)
  assert.equal(first.imageAssets[0].publicId, 'owned-custom-image')
})