# Secrets Manager slot module.
#
# Declares secret slots without populating their values. Slots are created
# empty by Terraform; values are populated out-of-band by a local admin:
#
#   aws secretsmanager put-secret-value \
#     --secret-id <project>-<env>/<name> \
#     --secret-string '<value>'
#
# CI is intentionally NOT granted secretsmanager:GetSecretValue or
# secretsmanager:PutSecretValue. Same chicken-and-egg argument as the
# github-oidc bootstrap stack: a CI role that can rewrite its own secrets is
# a CI role that can be tricked into dropping its own access. Population is
# always a deliberate human action from local admin creds.
#
# Consumers (Lambdas, Aurora) read secrets at runtime via the consumer's own
# IAM role — grant secretsmanager:GetSecretValue on the specific ARN there,
# never on the CI role.
#
# Encryption uses the AWS-managed `aws/secretsmanager` KMS key. A customer-
# managed key is a follow-up if compliance demands key-rotation control.

resource "aws_secretsmanager_secret" "slot" {
  for_each = toset(var.secret_names)

  name                    = "${var.project}-${var.env}/${each.value}"
  description             = "${var.project} ${var.env} secret slot: ${each.value}. Populated out-of-band by an operator."
  recovery_window_in_days = var.recovery_window_days

  tags = {
    Slot = each.value
  }
}
