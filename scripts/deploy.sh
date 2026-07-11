#!/usr/bin/env bash

# Stop immediately on error
set -e

if [[ -z "$1" ]]; then
  $(./scripts/assumeDeveloperRole.sh)
fi

# Build from template

SAM_TEMPLATE=template.yaml
sam build --template ${SAM_TEMPLATE} --use-container --container-env-var NODE_ENV=production

# Deploy build lambda

GOOGLE_API_KEY=$(aws ssm get-parameter --name google-places-api | jq -r '.Parameter.Value')
RECAPTCHA_SECRET_KEY=$(aws ssm get-parameter --name recaptcha-secret-key | jq -r '.Parameter.Value')
SMS_API_KEY=$(aws apigateway get-api-key --api-key l3q9ffyih6 --include-value --region us-east-1 | jq -r '.value')
TESTING_ARTIFACTS_BUCKET=choosee-lambda-test
TESTING_CLOUDFORMATION_EXECUTION_ROLE="arn:aws:iam::$AWS_ACCOUNT_ID:role/choosee-cloudformation-test"
TESTING_STACK_NAME=choosee-api-test
sam deploy --stack-name ${TESTING_STACK_NAME} \
           --capabilities CAPABILITY_IAM \
           --region us-east-2 \
           --s3-bucket ${TESTING_ARTIFACTS_BUCKET} \
           --s3-prefix ${TESTING_STACK_NAME} \
           --no-fail-on-empty-changeset \
           --role-arn ${TESTING_CLOUDFORMATION_EXECUTION_ROLE} \
           --parameter-overrides "Environment=test GoogleApiKey=$GOOGLE_API_KEY RecaptchaSecretKey=$RECAPTCHA_SECRET_KEY SmsApiKey=$SMS_API_KEY"
