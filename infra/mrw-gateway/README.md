# ZENVIA MRW Gateway

Gateway mínimo para sacar las llamadas a MRW SAGEC por una única IP pública fija.

## Por qué existe

Supabase Edge Functions no garantizan una IP de salida fija. MRW está devolviendo HTTP 500 incluso al consultar el WSDL desde Edge, mientras el mismo contrato funciona desde Sendcloud.

Arquitectura:

```
ZENVIA Gestión -> Supabase Edge -> API Gateway -> Lambda privada -> NAT Gateway/EIP -> MRW SAGEC
```

La Lambda solo permite los endpoints MRW definidos en el código y exige `X-Zenvia-Gateway-Key`.

## Despliegue

```bash
cd infra/mrw-gateway
export TF_VAR_gateway_secret="$(openssl rand -hex 32)"
terraform init
terraform apply
```

Guarda los outputs:

- `gateway_url`: valor de `MRW_GATEWAY_URL` en Supabase.
- `static_egress_ip`: IP que se puede facilitar a MRW para allowlisting.

Configura también el mismo secreto como `MRW_GATEWAY_SECRET` en Supabase.

No subas el secreto al repositorio ni a variables `.tfvars` versionadas.
