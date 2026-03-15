resource "google_container_cluster" "solprobe" {
  provider = google-beta

  name     = var.cluster_name
  location = var.region

  network    = google_compute_network.solprobe.id
  subnetwork = google_compute_subnetwork.solprobe.id

  # Use separately managed node pools
  remove_default_node_pool = true
  initial_node_count       = 1

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  logging_config {
    enable_components = ["SYSTEM_COMPONENTS", "WORKLOADS"]
  }

  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS"]
  }

  release_channel {
    channel = "REGULAR"
  }
}

# Default node pool for backend and dashboard
resource "google_container_node_pool" "default" {
  name     = "default-pool"
  location = var.region
  cluster  = google_container_cluster.solprobe.name

  node_count = 3

  node_config {
    machine_type = var.default_machine_type

    service_account = google_service_account.gke_nodes.email
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }
}

# GPU node pool for sidecar (T4 GPUs)
resource "google_container_node_pool" "gpu" {
  name     = "gpu-pool"
  location = var.region
  cluster  = google_container_cluster.solprobe.name

  autoscaling {
    min_node_count = 1
    max_node_count = 4
  }

  node_config {
    machine_type = var.gpu_machine_type

    guest_accelerator {
      type  = "nvidia-tesla-t4"
      count = var.gpu_count
      gpu_driver_installation_config {
        gpu_driver_version = "LATEST"
      }
    }

    labels = {
      "solprobe.io/gpu" = "true"
    }

    taint {
      key    = "nvidia.com/gpu"
      value  = "present"
      effect = "NO_SCHEDULE"
    }

    service_account = google_service_account.gke_nodes.email
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }
}
