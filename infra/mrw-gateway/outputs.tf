output "gateway_url" {
  description = "Use as MRW_GATEWAY_URL in Supabase."
  value       = "${aws_apigatewayv2_api.this.api_endpoint}/mrw"
}

output "static_egress_ip" {
  description = "Public IP used by all MRW requests. Give this IP to MRW if they require allowlisting."
  value       = aws_eip.nat.public_ip
}
