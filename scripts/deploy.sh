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

GOOGLE_CLIENT_ID=$(aws ssm get-parameter --name /pick-a-time/google-client-id --with-decryption --region us-east-1 --query Parameter.Value --output text)
GOOGLE_CLIENT_SECRET=$(aws ssm get-parameter --name /pick-a-time/google-client-secret --with-decryption --region us-east-1 --query Parameter.Value --output text)
TESTING_ARTIFACTS_BUCKET=pick-a-time-lambda-test
TESTING_CLOUDFORMATION_EXECUTION_ROLE="arn:aws:iam::$AWS_ACCOUNT_ID:role/pick-a-time-cloudformation-test"
TESTING_STACK_NAME=pick-a-time-api-test
sam deploy --stack-name ${TESTING_STACK_NAME} \
           --capabilities CAPABILITY_IAM \
           --region us-east-1 \
           --s3-bucket ${TESTING_ARTIFACTS_BUCKET} \
           --s3-prefix ${TESTING_STACK_NAME} \
           --no-fail-on-empty-changeset \
           --role-arn ${TESTING_CLOUDFORMATION_EXECUTION_ROLE} \
           --parameter-overrides "Environment=test GoogleClientId=$GOOGLE_CLIENT_ID GoogleClientSecret=$GOOGLE_CLIENT_SECRET"
