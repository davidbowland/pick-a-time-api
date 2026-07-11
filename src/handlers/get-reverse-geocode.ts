import { ValidationError } from '../errors'
import { fetchAddressFromGeocode } from '../services/google-maps'
import { getCaptchaScore } from '../services/recaptcha'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { extractRecaptchaToken, parseLatLng } from '../utils/events'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const token = extractRecaptchaToken(event)
    const score = await getCaptchaScore(token)
    log('reCAPTCHA result', { score })
    if (score < 0.7) {
      return status.FORBIDDEN
    }

    const { latitude, longitude } = parseLatLng(event)

    const result = await fetchAddressFromGeocode(latitude, longitude)
    const address = result.data.results[0]?.formatted_address
    if (address === undefined) {
      return status.NOT_FOUND
    }
    return { ...status.OK, body: JSON.stringify({ address }) }
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
