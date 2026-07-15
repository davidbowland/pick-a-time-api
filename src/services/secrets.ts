import { GetParameterCommand, SSM } from '@aws-sdk/client-ssm'

import {
  googleCalendarClientIdParamName,
  googleCalendarClientSecretParamName,
  oauthStateSecretParamName,
  recaptchaSecretKeyParamName,
} from '../config'
import { xrayCapture } from '../utils/logging'

const ssm = xrayCapture(new SSM({}))

const CACHE_TTL_MS = 10 * 60 * 1000

interface CachedSecret {
  value: string
  expiresAt: number
}

const cache = new Map<string, CachedSecret>()

const getParameter = async (name: string, now: () => number = Date.now): Promise<string> => {
  const cached = cache.get(name)
  if (cached && cached.expiresAt > now()) {
    return cached.value
  }
  const response = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }))
  const value = response.Parameter?.Value
  if (value === undefined) {
    throw new Error(`SSM parameter ${name} has no value`)
  }
  cache.set(name, { value, expiresAt: now() + CACHE_TTL_MS })
  return value
}

export const getRecaptchaSecretKey = (now: () => number = Date.now): Promise<string> =>
  getParameter(recaptchaSecretKeyParamName, now)

export const getOauthStateSecret = (now: () => number = Date.now): Promise<string> =>
  getParameter(oauthStateSecretParamName, now)

export const getGoogleCalendarClientId = (now: () => number = Date.now): Promise<string> =>
  getParameter(googleCalendarClientIdParamName, now)

export const getGoogleCalendarClientSecret = (now: () => number = Date.now): Promise<string> =>
  getParameter(googleCalendarClientSecretParamName, now)
