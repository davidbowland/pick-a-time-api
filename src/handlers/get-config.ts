import {
  allowedSlotMinutes,
  defaultSlotMinutes,
  maxPollDateRangeDays,
  maxPollDates,
  maxUsersPerSession,
  participantNameMaxLength,
  pollNameMaxLength,
  sessionExpireHours,
  startEndMinuteStep,
} from '../config'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { log } from '../utils/logging'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  return {
    ...status.OK,
    body: JSON.stringify({
      maxPollDates,
      pollNameMaxLength,
      participantNameMaxLength,
      allowedSlotMinutes,
      defaultSlotMinutes,
      startEndMinuteStep,
      maxPollDateRangeDays,
      maxUsersPerSession,
      sessionExpireHours,
    }),
  }
}
