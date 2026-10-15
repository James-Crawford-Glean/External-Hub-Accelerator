output "warm_schedule_name" {
  value = aws_scheduler_schedule.warm.name
}

output "cool_schedule_name" {
  value = aws_scheduler_schedule.cool.name
}

output "scheduler_role_arn" {
  value = aws_iam_role.scheduler.arn
}
