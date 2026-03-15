variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "us-central1"
}

variable "cluster_name" {
  description = "GKE cluster name"
  type        = string
  default     = "solprobe-cluster"
}

variable "gpu_count" {
  description = "Number of GPUs per node in the GPU node pool"
  type        = number
  default     = 1
}

variable "gpu_machine_type" {
  description = "Machine type for GPU node pool"
  type        = string
  default     = "n1-standard-4"
}

variable "default_machine_type" {
  description = "Machine type for default node pool"
  type        = string
  default     = "e2-standard-4"
}
