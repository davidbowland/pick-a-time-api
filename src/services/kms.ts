import { DecryptCommand, EncryptCommand, KMS } from '@aws-sdk/client-kms'

import { kmsCalendarKeyId } from '../config'
import { xrayCapture } from '../utils/logging'

const kms = xrayCapture(new KMS({}))

export const encryptRefreshToken = async (plaintext: string): Promise<string> => {
  const response = await kms.send(
    new EncryptCommand({ KeyId: kmsCalendarKeyId, Plaintext: Buffer.from(plaintext, 'utf8') }),
  )
  if (!response.CiphertextBlob) {
    throw new Error('KMS Encrypt returned no CiphertextBlob')
  }
  return Buffer.from(response.CiphertextBlob).toString('base64')
}

export const decryptRefreshToken = async (ciphertext: string): Promise<string> => {
  const response = await kms.send(
    new DecryptCommand({ CiphertextBlob: Buffer.from(ciphertext, 'base64'), KeyId: kmsCalendarKeyId }),
  )
  if (!response.Plaintext) {
    throw new Error('KMS Decrypt returned no Plaintext')
  }
  return Buffer.from(response.Plaintext).toString('utf8')
}
