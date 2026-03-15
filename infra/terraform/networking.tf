resource "google_compute_network" "solprobe" {
  name                    = "${var.cluster_name}-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "solprobe" {
  name          = "${var.cluster_name}-subnet"
  ip_cidr_range = "10.0.0.0/20"
  region        = var.region
  network       = google_compute_network.solprobe.id

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.4.0.0/14"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.8.0.0/20"
  }
}

# Allow internal traffic within the VPC
resource "google_compute_firewall" "internal" {
  name    = "${var.cluster_name}-allow-internal"
  network = google_compute_network.solprobe.name

  allow {
    protocol = "tcp"
  }

  allow {
    protocol = "udp"
  }

  allow {
    protocol = "icmp"
  }

  source_ranges = ["10.0.0.0/8"]
}

# Allow health check traffic from GCP load balancers
resource "google_compute_firewall" "health_checks" {
  name    = "${var.cluster_name}-allow-health-checks"
  network = google_compute_network.solprobe.name

  allow {
    protocol = "tcp"
    ports    = ["80", "443", "8000", "9100"]
  }

  source_ranges = [
    "35.191.0.0/16",
    "130.211.0.0/22",
  ]
}

# Cloud NAT for outbound internet access
resource "google_compute_router" "solprobe" {
  name    = "${var.cluster_name}-router"
  region  = var.region
  network = google_compute_network.solprobe.id
}

resource "google_compute_router_nat" "solprobe" {
  name                               = "${var.cluster_name}-nat"
  router                             = google_compute_router.solprobe.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}
