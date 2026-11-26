import Replicate from 'replicate'

export const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN ?? '',
})

export type FluxModel = 'flux-1.1-pro' | 'flux-schnell'

const MODEL_IDS: Record<FluxModel, `${string}/${string}:${string}` | `${string}/${string}`> = {
  'flux-1.1-pro': 'black-forest-labs/flux-1.1-pro',
  'flux-schnell': 'black-forest-labs/flux-schnell',
}

export interface FluxOptions {
  width?: number
  height?: number
  model?: FluxModel
  steps?: number
}

export async function generateWithFlux(
  prompt: string,
  options: FluxOptions = {}
): Promise<string> {
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('REPLICATE_API_TOKEN not set')
  }

  const model = options.model ?? 'flux-1.1-pro'
  const modelId = MODEL_IDS[model]

  const output = await replicate.run(modelId as Parameters<typeof replicate.run>[0], {
    input: {
      prompt,
      width: options.width ?? 1024,
      height: options.height ?? 1024,
      num_inference_steps: options.steps ?? (model === 'flux-schnell' ? 4 : 28),
      output_format: 'webp',
      output_quality: 90,
    },
  })

  const url = Array.isArray(output) ? output[0] : output
  const str = url instanceof URL ? url.toString() : String(url)
  if (!str || !str.startsWith('http')) throw new Error('Replicate returned no image URL')
  return str
}

export function hasReplicateKey(): boolean {
  return !!process.env.REPLICATE_API_TOKEN
}
