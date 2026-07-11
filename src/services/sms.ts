import axios, { AxiosResponse } from 'axios'

import { smsApiUrl } from '../config'
import { SMSMessage } from '../types'
import { xrayCaptureHttps } from '../utils/logging'
import { getSmsApiKey } from './secrets'

xrayCaptureHttps()
const api = axios.create({
  baseURL: smsApiUrl,
})

/* SMS */

const convertContentsToJson = (to: string, contents: string): SMSMessage => ({
  contents,
  messageType: 'TRANSACTIONAL',
  to,
})

export const sendRawSms = async (body: SMSMessage): Promise<AxiosResponse> =>
  api.post('/messages', body, { headers: { 'x-api-key': await getSmsApiKey() } })

export const sendSms = (to: string, contents: string): Promise<AxiosResponse> =>
  sendRawSms(convertContentsToJson(to, contents))
