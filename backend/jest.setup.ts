// Test env for modules that read process.env at load.
process.env.AURORA_CLUSTER_ARN ||= 'arn:aws:rds:us-east-2:000000000000:cluster:test';
process.env.AURORA_SECRET_ARN ||= 'arn:aws:secretsmanager:us-east-2:000000000000:secret:test';
