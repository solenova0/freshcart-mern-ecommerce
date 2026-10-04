import { z } from 'zod'

const objectId = z.string().regex(/^[a-f0-9]{24}$/i)
const categoryFields = {
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().toLowerCase().max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(4000),
}
const productFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10000),
  price: z.number().finite().nonnegative(),
  stock: z.number().int().nonnegative(),
  category: objectId,
  productType: z.enum(['grocery', 'hookah']),
  attributes: z.record(z.string().min(1).max(100), z.json()),
}

export const idSchema = z.strictObject({ id: objectId })
export const createCategorySchema = z.strictObject({
  ...categoryFields,
  description: categoryFields.description.default(''),
})
export const updateCategorySchema = z.strictObject(categoryFields).partial()
  .refine((values) => Object.keys(values).length > 0, { message: 'Provide at least one category field' })
export const createProductSchema = z.strictObject({
  ...productFields,
  description: productFields.description.default(''),
  stock: productFields.stock.default(0),
  productType: productFields.productType.default('grocery'),
  attributes: productFields.attributes.default({}),
})
export const updateProductSchema = z.strictObject(productFields).partial()
  .refine((values) => Object.keys(values).length > 0, { message: 'Provide at least one product field' })

function positiveQueryInteger(maximum) {
  return z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(maximum))
}

export const productListSchema = z.strictObject({
  search: z.string().trim().min(1).max(200).optional(),
  category: objectId.optional(),
  productType: z.enum(['grocery', 'hookah']).optional(),
  sort: z.enum(['price_asc', 'price_desc', 'newest', 'relevance']).optional(),
  page: positiveQueryInteger(10000).default(1),
  limit: positiveQueryInteger(50).default(20),
}).refine((values) => values.sort !== 'relevance' || Boolean(values.search), {
  message: 'Relevance sorting requires a search term', path: ['sort'],
})

export function buildProductQuery({ search, category, productType, sort, page, limit }) {
  const filter = {}
  if (search) filter.$text = { $search: search }
  if (category) filter.category = category
  if (productType) filter.productType = productType
  const sortName = sort || (search ? 'relevance' : 'newest')
  const sorts = {
    price_asc: { price: 1, _id: 1 },
    price_desc: { price: -1, _id: 1 },
    newest: { createdAt: -1, _id: -1 },
    relevance: { score: { $meta: 'textScore' }, _id: 1 },
  }
  return { filter, sort: sorts[sortName], skip: (page - 1) * limit, limit }
}