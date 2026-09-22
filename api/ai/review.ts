import { createAiApiHandler } from '../../server/aiApi.ts'

export const config = {
  maxDuration: 60,
}

export default createAiApiHandler('review')
