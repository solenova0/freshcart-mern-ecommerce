import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Writable } from 'node:stream'
import mongoose from 'mongoose'
import request from 'supertest'
import { createApp } from '../src/app.js'
import Product from '../src/models/Product.js'
import Category from '../src/models/Category.js'
import User from '../src/models/User.js'
import { signSession } from '../src/auth/session.js'
import { cleanupImages, replaceCatalogImages } from '../src/catalog/images.js'
import { createCloudinaryImageService } from '../src/services/cloudinary.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXMsAAAAASUVORK5CYII=', 'base64')
const file = { buffer: png, mimetype: 'image/png' }

function catalogFixture({ role = 'admin' } = {}) {
  const state = { events: [], removed: [], uploads: 0, conflict: false, cleanupFailure: false, lastFilter: undefined }
  const config = { nodeEnv: 'test', corsOrigins: ['http://localhost:5173'], jwtSecret: 'a-test-secret-with-at-least-32-bytes', jwtTtlSeconds: 3600, cloudinaryFolder: 'freshcart' }
  const user = new User({ name: 'Admin', email: 'admin@example.com', passwordHash: 'hash', role, isVerified: true })
  state.cookie = `freshcart_session=${signSession(user, config)}`

  function modelAdapter(Model) {
    const records = new Map()
    function matches(record, filter) {
      return Object.entries(filter).every(([field, value]) => {
        if (field === '$text') return `${record.name} ${record.description}`.toLowerCase().includes(value.$search.toLowerCase())
        if (value && typeof value === 'object' && '$in' in value) return value.$in.some((entry) => String(entry) === String(record[field]))
        return String(record[field]) === String(value)
      })
    }
    function document(record) {
      const doc = new Model(record)
      doc.save = async () => {
        const current = records.get(doc.id)
        if (state.conflict) { current.__v += 1; state.conflict = false }
        if (doc.__v !== current.__v) throw new mongoose.Error.VersionError(doc, current.__v, ['images'])
        await doc.validate()
        if (Model === Category && [...records.values()].some((item) => item._id !== doc.id && item.slug === doc.slug)) {
          const error = new Error('Duplicate slug')
          error.code = 11000
          throw error
        }
        doc.__v += 1
        records.set(doc.id, JSON.parse(JSON.stringify(doc.toObject())))
        state.events.push(`save:${Model.modelName}`)
        return doc
      }
      return doc
    }
    function query(read, isList = false) {
      let sorting
      let offset = 0
      let count = Infinity
      return {
        select() { return this },
        populate() { return this },
        sort(value) { sorting = value; return this },
        skip(value) { offset = value; return this },
        limit(value) { count = value; return this },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            let result = read()
            if (!isList) return result ? document(result) : null
            if (sorting) result = result.sort((first, second) => {
              for (const [field, direction] of Object.entries(sorting)) {
                if (typeof direction !== 'number') continue
                const compare = first[field] > second[field] ? 1 : first[field] < second[field] ? -1 : 0
                if (compare) return compare * direction
              }
              return 0
            })
            return result.slice(offset, offset + count).map(document)
          }).then(resolve, reject)
        },
      }
    }
    return {
      records,
      async create(values) {
        const doc = new Model({ ...values, __v: 0, createdAt: new Date(), updatedAt: new Date() })
        await doc.validate()
        if (Model === Category && [...records.values()].some((item) => item.slug === doc.slug)) {
          const error = new Error('Duplicate slug')
          error.code = 11000
          throw error
        }
        records.set(doc.id, JSON.parse(JSON.stringify(doc.toObject())))
        return document(records.get(doc.id))
      },
      find(filter = {}) {
        if (Model === Product) state.lastFilter = filter
        return query(() => [...records.values()].filter((record) => matches(record, filter)), true)
      },
      findById(id) { return query(() => records.get(id.toString())) },
      async exists(filter) { return [...records.values()].some((record) => matches(record, filter)) },
      async countDocuments(filter) { return [...records.values()].filter((record) => matches(record, filter)).length },
      async findOneAndDelete(filter) {
        const record = [...records.values()].find((item) => matches(item, filter))
        if (!record) return null
        records.delete(record._id)
        return document(record)
      },
    }
  }

  state.CategoryModel = modelAdapter(Category)
  state.ProductModel = modelAdapter(Product)
  state.OrderModel = { async aggregate(pipeline) {
    assert.deepEqual(pipeline[0], { $match: { paymentStatus: 'paid', orderStatus: { $ne: 'cancelled' } } })
    return state.bestSellers || []
  } }
  state.imageService = {
    async upload(buffer, folder) {
      assert.deepEqual(buffer, png)
      state.uploads += 1
      state.events.push('upload')
      if (state.failUploadAt === state.uploads) {
        const error = new Error('Image storage unavailable')
        error.status = 503
        throw error
      }
      return { url: `https://example.com/image-${state.uploads}.png`, publicId: `${folder}/image-${state.uploads}` }
    },
    async remove(publicId) {
      state.removed.push(publicId)
      state.events.push(`remove:${publicId}`)
      if (state.cleanupFailure) throw new Error('Cleanup unavailable')
    },
  }
  state.app = createApp(config, {
    CategoryModel: state.CategoryModel, ProductModel: state.ProductModel, OrderModel: state.OrderModel, imageService: state.imageService,
    UserModel: { findById(id) { return { select: async () => id === user.id ? user : null } } },
  })
  return state
}

async function sampleProduct(state, values = {}) {
  const category = await state.CategoryModel.create({ name: 'Groceries', slug: 'groceries' })
  const product = await state.ProductModel.create({ name: 'Apples', price: 2.5, stock: 10, category: category._id, ...values })
  return { product, category }
}

test('replacement persists uploaded assets before deleting old Cloudinary images', async () => {
  const events = []
  const imageService = {
    async upload(buffer, folder) {
      assert.deepEqual(buffer, png)
      assert.equal(folder, 'freshcart/products/example')
      events.push('upload')
      return { url: 'https://example.com/new.png', publicId: 'new' }
    },
    async remove(publicId) { events.push(`remove:${publicId}`) },
  }
  const result = await replaceCatalogImages({
    files: [file], folder: 'freshcart/products/example', oldPublicIds: ['old'], imageService,
    async persist(assets) { assert.equal(assets[0].publicId, 'new'); events.push('persist') },
  })
  assert.deepEqual(events, ['upload', 'persist', 'remove:old'])
  assert.equal(result.cleanupFailed, false)
})

test('invalid signatures, mismatched content types, missing files, and oversized images never upload', async () => {
  const imageService = { upload: () => assert.fail('Invalid image must not upload') }
  for (const files of [[], [{ buffer: Buffer.from('not an image'), mimetype: 'image/png' }], [{ buffer: png, mimetype: 'image/jpeg' }]]) {
    await assert.rejects(replaceCatalogImages({ files, oldPublicIds: [], imageService, persist: () => assert.fail('Must not persist') }))
  }
  await assert.rejects(replaceCatalogImages({
    files: [{ buffer: Buffer.alloc(5 * 1024 * 1024 + 1), mimetype: 'image/png' }],
    oldPublicIds: [], imageService,
  }), { status: 413 })
})

test('partial upload failure deletes newly uploaded assets without touching existing images', async () => {
  let uploads = 0
  const removed = []
  const imageService = {
    async upload() {
      uploads += 1
      if (uploads === 2) throw new Error('Upload failed')
      return { url: 'https://example.com/new.png', publicId: 'new' }
    },
    async remove(publicId) { removed.push(publicId) },
  }
  await assert.rejects(replaceCatalogImages({ files: [file, file], oldPublicIds: ['old'], imageService, persist: () => assert.fail('Partial uploads must not persist') }))
  assert.deepEqual(removed, ['new'])
})

test('failed persistence deletes replacement assets while preserving old images', async () => {
  const removed = []
  const imageService = {
    async upload() { return { url: 'https://example.com/new.png', publicId: 'new' } },
    async remove(publicId) { removed.push(publicId) },
  }
  await assert.rejects(replaceCatalogImages({
    files: [file], oldPublicIds: ['old'], imageService,
    async persist() { throw new Error('Write conflict') },
  }), /Write conflict/)
  assert.deepEqual(removed, ['new'])
})

test('cleanup failures are reported and duplicate public IDs are deleted only once', async (context) => {
  context.mock.method(console, 'error', () => {})
  const removed = []
  const failed = await cleanupImages(['old', 'old', undefined], {
    async remove(publicId) { removed.push(publicId); throw new Error('Provider unavailable') },
  })
  assert.equal(failed, true)
  assert.deepEqual(removed, ['old'])
})

test('Cloudinary uses streamed memory buffers, server-generated IDs, and invalidating deletes', async () => {
  const config = { cloudinaryCloudName: 'test-cloud', cloudinaryApiKey: 'test-key', cloudinaryApiSecret: 'test-secret' }
  let options
  const chunks = []
  let deletion
  const imageService = createCloudinaryImageService(config, {
    upload_stream(settings, callback) {
      options = settings
      return new Writable({
        write(chunk, _encoding, done) { chunks.push(chunk); done() },
        final(done) { callback(null, { secure_url: 'https://example.com/photo.png', public_id: settings.public_id }); done() },
      })
    },
    async destroy(publicId, settings) { deletion = { publicId, settings }; return { result: 'ok' } },
  })
  const asset = await imageService.upload(png, 'freshcart/products/example')
  assert.deepEqual(Buffer.concat(chunks), png)
  assert.match(asset.publicId, /^freshcart\/products\/example\//)
  assert.equal(options.overwrite, false)
  assert.equal(options.api_secret, config.cloudinaryApiSecret)
  assert.deepEqual(options.allowed_formats, ['jpg', 'png', 'webp'])
  await imageService.remove(asset.publicId)
  assert.equal(deletion.publicId, asset.publicId)
  assert.equal(deletion.settings.invalidate, true)
})

test('uncertain Cloudinary uploads clean their preallocated public ID without leaking provider errors', async () => {
  let allocatedId
  const removed = []
  const imageService = createCloudinaryImageService({}, {
    upload_stream(settings) {
      allocatedId = settings.public_id
      throw new Error('Private provider details')
    },
    async destroy(publicId, options) {
      removed.push(publicId)
      assert.equal(options.timeout, 10000)
      return { result: 'not found' }
    },
  })
  await assert.rejects(imageService.upload(png, 'freshcart/products/example'), {
    status: 503, message: 'Image storage is temporarily unavailable',
  })
  assert.deepEqual(removed, [allocatedId])
})

test('catalog read endpoints are public and hide owned Cloudinary identifiers', async () => {
  const state = catalogFixture()
  const { category, product } = await sampleProduct(state, {
    images: ['https://example.com/old.png'], imageAssets: [{ url: 'https://example.com/old.png', publicId: 'old' }],
  })
  const categories = await request(state.app).get('/api/categories').expect(200)
  assert.equal(categories.body.categories[0].name, 'Groceries')
  await request(state.app).get(`/api/categories/${category.id}`).expect(200)
  const listing = await request(state.app).get('/api/products').expect(200)
  assert.deepEqual(listing.body.pagination, { page: 1, limit: 20, total: 1, pages: 1 })
  assert.equal(listing.body.products[0].imageAssets, undefined)
  const detail = await request(state.app).get(`/api/products/${product.id}`).expect(200)
  assert.equal(detail.body.product.name, 'Apples')
  assert.equal(detail.body.product.imageAssets, undefined)
})

test('catalog writes and uploads require a verified administrator before parsing files', async () => {
  for (const role of ['admin', 'user']) {
    const state = catalogFixture({ role })
    const { product, category } = await sampleProduct(state)
    const actions = [
      ['post', '/api/products'], ['patch', `/api/products/${product.id}`], ['delete', `/api/products/${product.id}`],
      ['post', `/api/products/${product.id}/images`], ['post', '/api/categories'],
      ['patch', `/api/categories/${category.id}`], ['delete', `/api/categories/${category.id}`], ['post', `/api/categories/${category.id}/image`],
    ]
    for (const [method, path] of actions) {
      await request(state.app)[method](path).expect(401)
      if (role === 'user') await request(state.app)[method](path).set('Cookie', state.cookie).expect(403)
    }
    assert.equal(state.uploads, 0)
  }
})

test('administrators can create and update categories/products without resetting omitted values', async () => {
  const state = catalogFixture()
  const createdCategory = await request(state.app).post('/api/categories').set('Cookie', state.cookie)
    .send({ name: 'Groceries', slug: 'groceries' }).expect(201)
  const categoryId = createdCategory.body.category._id
  const createdProduct = await request(state.app).post('/api/products').set('Cookie', state.cookie)
    .send({ name: 'Apples', price: 2.5, stock: 10, category: categoryId, attributes: { organic: true } }).expect(201)
  const productId = createdProduct.body.product._id
  const updated = await request(state.app).patch(`/api/products/${productId}`).set('Cookie', state.cookie).send({ price: 3 }).expect(200)
  assert.equal(updated.body.product.price, 3)
  assert.equal(updated.body.product.stock, 10)
  assert.deepEqual(updated.body.product.attributes, { organic: true })
  await request(state.app).patch(`/api/categories/${categoryId}`).set('Cookie', state.cookie).send({ name: 'Fresh groceries' }).expect(200)
  await request(state.app).post('/api/categories').set('Cookie', state.cookie).send({ name: 'Duplicate', slug: 'groceries' }).expect(409)
})

test('public listing combines search/category filters, stable price sorting and pagination', async () => {
  const state = catalogFixture()
  const { category } = await sampleProduct(state)
  await state.ProductModel.create({ name: 'Green apples', price: 4, category: category._id })
  await state.ProductModel.create({ name: 'Red apples', price: 3, category: category._id })
  const other = await state.CategoryModel.create({ name: 'Hookah', slug: 'hookah' })
  await state.ProductModel.create({ name: 'Apples accessory', price: 1, productType: 'hookah', category: other._id })
  const response = await request(state.app).get('/api/products').query({ search: 'apples', category: category.id, sort: 'price_desc', page: '2', limit: '1' }).expect(200)
  assert.equal(response.body.products[0].name, 'Red apples')
  assert.deepEqual(response.body.pagination, { page: 2, limit: 1, total: 3, pages: 3 })
  assert.deepEqual(state.lastFilter, { $text: { $search: 'apples' }, category: category.id })
  const ascending = await request(state.app).get('/api/products').query({ category: category.id, sort: 'price_asc' }).expect(200)
  assert.deepEqual(ascending.body.products.map((item) => item.price), [2.5, 3, 4])
  const empty = await request(state.app).get('/api/products').query({ page: '100' }).expect(200)
  assert.deepEqual(empty.body.products, [])
})

test('invalid inputs, nonexistent categories, missing records, and cross-site writes are rejected', async () => {
  const state = catalogFixture()
  const { product } = await sampleProduct(state)
  await request(state.app).get('/api/products/invalid').expect(400)
  await request(state.app).get('/api/products').query({ limit: '1000' }).expect(400)
  await request(state.app).get('/api/products').query({ 'category[$ne]': 'invalid' }).expect(400)
  await request(state.app).get(`/api/products/${'a'.repeat(24)}`).expect(404)
  await request(state.app).get(`/api/categories/${'a'.repeat(24)}`).expect(404)
  await request(state.app).post('/api/products').set('Cookie', state.cookie).send({ name: 'Test', price: 1, category: 'a'.repeat(24) }).expect(400)
  await request(state.app).patch(`/api/products/${product.id}`).set('Cookie', state.cookie).send({ category: 'a'.repeat(24) }).expect(400)
  await request(state.app).patch(`/api/products/${product.id}`).set('Cookie', state.cookie).send({ images: [] }).expect(400)
  await request(state.app).patch(`/api/products/${product.id}`).set('Cookie', state.cookie).send({}).expect(400)
  await request(state.app).delete(`/api/products/${product.id}`).set('Cookie', state.cookie).set('Sec-Fetch-Site', 'cross-site').expect(403)
})

test('category deletion is blocked while products reference it and owned images are deleted with records', async () => {
  const state = catalogFixture()
  const { category, product } = await sampleProduct(state, {
    images: ['https://example.com/old.png'], imageAssets: [{ url: 'https://example.com/old.png', publicId: 'old' }],
  })
  await request(state.app).delete(`/api/categories/${category.id}`).set('Cookie', state.cookie).expect(409)
  assert.equal(state.CategoryModel.records.size, 1)
  await request(state.app).delete(`/api/products/${product.id}`).set('Cookie', state.cookie).expect(204)
  assert.deepEqual(state.removed, ['old'])
  await request(state.app).delete(`/api/categories/${category.id}`).set('Cookie', state.cookie).expect(204)
  assert.equal(state.CategoryModel.records.size, 0)
  assert.equal(state.ProductModel.records.size, 0)
})

test('multipart product uploads replace the entire image list and delete owned old images after save', async () => {
  const state = catalogFixture()
  const { product } = await sampleProduct(state, {
    images: ['https://example.com/old.png'], imageAssets: [{ url: 'https://example.com/old.png', publicId: 'old' }],
  })
  const response = await request(state.app).post(`/api/products/${product.id}/images`).set('Cookie', state.cookie)
    .attach('images', png, { filename: 'photo.png', contentType: 'image/png' }).expect(200)
  assert.deepEqual(response.body.product.images, ['https://example.com/image-1.png'])
  assert.equal(response.body.product.imageAssets, undefined)
  assert.equal(response.body.cleanupFailed, false)
  assert.deepEqual(state.events, ['upload', 'save:Product', 'remove:old'])
  assert.equal(state.ProductModel.records.get(product.id).imageAssets.length, 1)
})

test('multipart category image uploads support replacement and cleanup on deletion', async () => {
  const state = catalogFixture()
  const category = await state.CategoryModel.create({ name: 'Groceries', slug: 'groceries', image: 'https://example.com/old.png', imagePublicId: 'old-category' })
  const response = await request(state.app).post(`/api/categories/${category.id}/image`).set('Cookie', state.cookie)
    .attach('image', png, { filename: 'photo.png', contentType: 'image/png' }).expect(200)
  assert.equal(response.body.category.image, 'https://example.com/image-1.png')
  assert.equal(response.body.category.imagePublicId, undefined)
  assert.deepEqual(state.removed, ['old-category'])
  await request(state.app).delete(`/api/categories/${category.id}`).set('Cookie', state.cookie).expect(204)
  assert.equal(state.removed.length, 2)
})

test('multipart endpoints reject unsupported/mismatched images, missing files, extra files, and oversize files', async () => {
  const state = catalogFixture()
  const { product } = await sampleProduct(state)
  const path = `/api/products/${product.id}/images`
  await request(state.app).post(path).set('Cookie', state.cookie).expect(400)
  await request(state.app).post(path).set('Cookie', state.cookie).attach('images', Buffer.from('<svg/>'), { filename: 'image.svg', contentType: 'image/svg+xml' }).expect(415)
  await request(state.app).post(path).set('Cookie', state.cookie).attach('images', png, { filename: 'image.jpg', contentType: 'image/jpeg' }).expect(415)
  await request(state.app).post(path).set('Cookie', state.cookie).attach('images', Buffer.from('invalid'), { filename: 'image.png', contentType: 'image/png' }).expect(415)
  let extra = request(state.app).post(path).set('Cookie', state.cookie)
  for (let count = 0; count < 6; count += 1) extra = extra.attach('images', png, { filename: 'image.png', contentType: 'image/png' })
  await extra.expect(400)
  await request(state.app).post(path).set('Cookie', state.cookie).attach('images', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'image.png', contentType: 'image/png' }).expect(413)
  assert.equal(state.uploads, 0)
})

test('upload conflicts keep original URLs and delete the new Cloudinary asset', async () => {
  const state = catalogFixture()
  const { product } = await sampleProduct(state, {
    images: ['https://example.com/old.png'], imageAssets: [{ url: 'https://example.com/old.png', publicId: 'old' }],
  })
  state.conflict = true
  await request(state.app).post(`/api/products/${product.id}/images`).set('Cookie', state.cookie)
    .attach('images', png, { filename: 'photo.png', contentType: 'image/png' }).expect(409)
  assert.deepEqual(state.ProductModel.records.get(product.id).images, ['https://example.com/old.png'])
  assert.equal(state.removed.length, 1)
  assert.notEqual(state.removed[0], 'old')
})

test('old-image cleanup failure does not roll back committed replacement URLs', async (context) => {
  context.mock.method(console, 'error', () => {})
  const state = catalogFixture()
  const { product } = await sampleProduct(state, {
    images: ['https://example.com/old.png'], imageAssets: [{ url: 'https://example.com/old.png', publicId: 'old' }],
  })
  state.cleanupFailure = true
  const response = await request(state.app).post(`/api/products/${product.id}/images`).set('Cookie', state.cookie)
    .attach('images', png, { filename: 'photo.png', contentType: 'image/png' }).expect(200)
  assert.equal(response.body.cleanupFailed, true)
  assert.deepEqual(state.ProductModel.records.get(product.id).images, ['https://example.com/image-1.png'])
})

test('admins cannot delete reserved products or reduce stock below reservations', async () => {
  const state = catalogFixture()
  const { product } = await sampleProduct(state, { reservedStock: 2 })
  await request(state.app).delete(`/api/products/${product.id}`).set('Cookie', state.cookie).expect(409)
  await request(state.app).patch(`/api/products/${product.id}`).set('Cookie', state.cookie).send({ stock: 1 }).expect(409)
  assert.equal(state.ProductModel.records.has(product.id), true)
})

test('category multi-image upload marks the first primary image and replaces/deletes all owned assets', async () => {
  const state = catalogFixture()
  const category = await state.CategoryModel.create({ name: 'Groceries', slug: 'groceries' })
  const first = await request(state.app).post(`/api/categories/${category.id}/images`).set('Cookie', state.cookie)
    .attach('images', png, { filename: 'one.png', contentType: 'image/png' })
    .attach('images', png, { filename: 'two.png', contentType: 'image/png' }).expect(200)
  assert.equal(first.body.category.images.length, 2)
  assert.equal(first.body.category.image, first.body.category.images[0])
  assert.equal(first.body.category.imageAssets, undefined)
  await request(state.app).post(`/api/categories/${category.id}/image`).set('Cookie', state.cookie)
    .attach('image', png, { filename: 'new.png', contentType: 'image/png' }).expect(200)
  assert.equal(state.removed.length, 2)
  await request(state.app).delete(`/api/categories/${category.id}`).set('Cookie', state.cookie).expect(204)
  assert.equal(state.removed.length, 3)
})

test('best sellers uses paid sales rank, skips removed products, and returns public product data', async () => {
  const state = catalogFixture()
  const { product, category } = await sampleProduct(state)
  const second = await state.ProductModel.create({ name: 'Bananas', price: 2, category: category._id })
  state.bestSellers = [{ _id: second._id, quantity: 10 }, { _id: product._id, quantity: 5 }, { _id: new mongoose.Types.ObjectId(), quantity: 1 }]
  const response = await request(state.app).get('/api/products/best-sellers').expect(200)
  assert.deepEqual(response.body.products.map((item) => item.name), ['Bananas', 'Apples'])
  assert.equal(response.body.products[0].imageAssets, undefined)
})