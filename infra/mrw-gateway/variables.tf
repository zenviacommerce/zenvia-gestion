variable "aws_region" {
  type        = string
  description = "AWS region for the MRW gateway."
  default     = "eu-south-2"
}

variable "name" {
  type        = string
  description = "Resource name prefix."
  default     = "zenvia-mrw-gateway"
}

variable "gateway_secret" {
  type        = string
  sensitive   = true
  description = "Shared secret expected in X-Zenvia-Gateway-Key."
}
