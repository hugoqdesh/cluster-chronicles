# Cluster Chronicles

Kubernetes migration of the Sherlock app to a local Minikube cluster, with Jenkins, persistent storage, Prometheus/Grafana, and Elasticsearch/Fluent Bit/Kibana.

## Requirements

Docker, Minikube, `kubectl`, Helm, and `crane` (used by `scripts/push-images.sh`). Start Docker before Minikube.

## Install

Start the cluster with the addons used by the manifests:

```bash
minikube start -p cluster-chronicles --cpus=6 --memory=8192 --cni=calico \
  --extra-config=kubelet.container-log-max-size=10Mi \
  --extra-config=kubelet.container-log-max-files=5 \
  --addons=ingress,metrics-server,registry
kubectl config use-context cluster-chronicles
```

Calico enforces the NetworkPolicies below. A cluster created with Minikube's default CNI does not enforce them; use Calico when creating the cluster.

Add the Helm repositories and create the project namespaces:

```bash
helm repo add jenkins https://charts.jenkins.io
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add fluent https://fluent.github.io/helm-charts
helm repo update

kubectl apply -f manifests/namespaces/namespaces.yaml
```

Create the Elasticsearch credentials before deploying logging components. Set the `elastic` password to the same value used by Elasticsearch, and set `kibana-system-password` to the password configured for Elasticsearch's `kibana_system` user:

```bash
kubectl -n observability create secret generic elastic-credentials \
  --from-literal=elastic-password='<elastic-password>' \
  --from-literal=kibana-system-password='<kibana-system-password>' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Install Jenkins, monitoring, and Fluent Bit, then apply their project configuration:

```bash
kubectl apply -f manifests/cicd/service-account.yaml
helm upgrade --install jenkins jenkins/jenkins -n cicd -f manifests/cicd/values.yaml
kubectl apply -f manifests/cicd/deployment-role.yaml -f manifests/cicd/deployment-role-binding.yaml

helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
  -n observability -f manifests/monitoring/values.yaml
kubectl apply -f manifests/monitoring/application-dashboard.yaml \
  -f manifests/monitoring/cluster-dashboard.yaml \
  -f manifests/monitoring/pod-container-dashboard.yaml \
  -f manifests/monitoring/backend-servicemonitor.yaml \
  -f manifests/monitoring/alerts.yaml \
  -f manifests/monitoring/alert-receiver.yaml

kubectl apply -f manifests/storage/elasticsearch-pv.yaml
kubectl apply -f manifests/logging/elasticsearch.yaml
kubectl -n observability rollout status statefulset/elasticsearch --timeout=5m
kubectl -n observability exec statefulset/elasticsearch -- bin/elasticsearch-reset-password -u kibana_system -i
kubectl apply -f manifests/logging/kibana.yaml

helm upgrade --install fluent-bit fluent/fluent-bit \
  -n observability -f manifests/logging/fluent-bit-values.yaml
kubectl apply -f manifests/logging/retention-job.yaml
helm upgrade --install elasticsearch-exporter prometheus-community/prometheus-elasticsearch-exporter \
  -n observability -f manifests/monitoring/elasticsearch-exporter-values.yaml
```

When prompted, enter the same `kibana-system-password` value stored in the Secret.

The Jenkins agent pod reads its build inputs from ConfigMaps in the `cicd` namespace. Create or refresh them after changing app source:

```bash
./scripts/sync-jenkins-source.sh
```

Build and publish the initial app images, then deploy the app resources:

```bash
./scripts/push-images.sh
kubectl apply -f manifests/backend -f manifests/frontend -f manifests/ingress
kubectl apply -f manifests/networking/network-policies.yaml
```

## Open and verify

For the Sherlock app URL to resolve, add this entry to your system's hosts file:

| System         | How to edit the hosts file                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| macOS or Linux | Edit `/etc/hosts` as an administrator (for example, run `sudo nano /etc/hosts`).                                            |
| Windows        | Open Notepad as Administrator, then open `C:\Windows\System32\drivers\etc\hosts` (choose **All files** in the Open dialog). |

Add this line on a new row and save the file:

```text
127.0.0.1 sherlock.local
```

Run each port-forward in its own terminal:

```bash
kubectl -n ingress-nginx port-forward service/ingress-nginx-controller 18080:80
kubectl -n cicd port-forward service/jenkins 18082:8080
kubectl -n observability port-forward service/monitoring-grafana 13000:80
kubectl -n observability port-forward service/kibana 15601:5601
kubectl -n observability port-forward service/monitoring-kube-prometheus-alertmanager 19093:9093
```

Then open:

- App: `http://sherlock.local:18080/`
- Jenkins: `http://localhost:18082`
- Grafana: `http://localhost:13000`
- Kibana: `http://localhost:15601`
- Alertmanager: `http://localhost:19093/#/alerts`

### Import the Kibana log searches

In Kibana, open the main menu (**☰**) and choose **Stack Management → Saved Objects**. Click **Import**, select `manifests/logging/kibana-views.ndjson` from the project folder on your computer, then click **Import** to confirm.

Verify the app route, workloads, storage, and log retention policy:

```bash
curl -H 'Host: sherlock.local' http://127.0.0.1:18080/api/health
kubectl -n sherlock-app get deployments,pods,services
kubectl get pvc -A
kubectl -n observability get job elasticsearch-log-retention
kubectl -n observability exec statefulset/elasticsearch -- sh -c 'curl -fsS -u "elastic:$ELASTIC_PASSWORD" http://localhost:9200/_ilm/policy/kubernetes-logs-retention'
```

## CI/CD usage

Jenkins runs in the `cicd` namespace and builds with Kaniko agent pods, so no Docker daemon is needed in the cluster.

Get the admin password (generated by the Helm chart, never stored in this repo):

```bash
kubectl -n cicd get secret jenkins -o jsonpath='{.data.jenkins-admin-password}' | base64 -d; echo
```

Log in at `http://localhost:18082` as `admin`, then create a **Pipeline** job and paste the root `Jenkinsfile` into the _Pipeline script_ field (or point it at this repository). Run `./scripts/sync-jenkins-source.sh` first so the agent sees the current app source.

The pipeline:

1. Tags the images `build-<BUILD_NUMBER>`.
2. Builds and pushes the backend and frontend images to the in-cluster registry.
3. Runs `kubectl set image` on both Deployments, which starts a rolling update.
4. Waits for `rollout status`. On failure it runs `rollout undo` on both Deployments and fails the build.

Manual rollback and history:

```bash
kubectl -n sherlock-app rollout history deployment/backend
kubectl -n sherlock-app rollout undo deployment/backend
```

Jenkins deploys through the `jenkins` ServiceAccount, which is limited by a namespaced Role (`manifests/cicd/deployment-role.yaml`) to managing Deployments in `sherlock-app`.

Secret rotation: change the value, then restart the pods that read it.

```bash
kubectl -n observability create secret generic elastic-credentials \
  --from-literal=elastic-password='<new-password>' \
  --from-literal=kibana-system-password='<kibana-system-password>' \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n observability rollout restart statefulset/elasticsearch deployment/kibana
```

Also change the `elastic` password inside Elasticsearch to match, then restart anything else that uses the Secret (Fluent Bit and the Elasticsearch exporter). Secrets are only ever created from the command line, never committed.

## Monitoring and alerting usage

Grafana (`http://localhost:13000`) has three dashboards, loaded from ConfigMaps in `manifests/monitoring/`:

- Cluster performance
- Pod and container
- Application performance (backend custom metrics from `/metrics`, scraped through `backend-servicemonitor.yaml`)

Alert rules live in `manifests/monitoring/alerts.yaml`. Alertmanager groups by `namespace` and `alertname`, waits 10s before the first notification, groups updates every 5m and repeats every 12h, so repeated firing does not flood the receiver. Notifications go to the `alert-receiver` webhook; read them with `kubectl -n observability logs deploy/alert-receiver`.

| Alert                     | Fires when                       | How to trigger                                                                          |
| ------------------------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| NodeCPUHigh               | node CPU > 80% for 5m            | `stress-ng --cpu 8 --timeout 360s` on the node                                          |
| NodeDiskSpaceLow          | free space on `/data` < 20%      | `fallocate -l 10G large_file.img` under `/data` on the node                             |
| NodeMemoryHigh            | node memory > 90% for 5m         | `stress-ng --vm 2 --vm-bytes 4G --timeout 360s` on the node                             |
| PodRestartsHigh           | > 3 restarts in 15m              | `kubectl run test-pod --image=alpine --restart=Always -- /bin/sh -c "sleep 10; exit 1"` |
| ContainerMemoryHigh       | memory > 80% of container limit  | pod with a 512Mi limit running `stress-ng --vm 1 --vm-bytes 450M`                       |
| PodPendingTooLong         | pod Pending for 5m               | apply a pod requesting more CPU/memory than the node has                                |
| APIServerUnavailable      | API server target down           | stop the Minikube API server container                                                  |
| ElasticsearchUnhealthy    | cluster status yellow or red     | create an index with `number_of_replicas: 1` on the single node                         |
| FluentBitCollectionErrors | Fluent Bit output errors or down | break the Elasticsearch output host or log path in Fluent Bit values                    |

The disk alert watches the `/data` mount of the Minikube node. Change the mountpoint in `alerts.yaml` on other clusters. Check firing alerts at `http://localhost:19093/#/alerts` or in Prometheus under **Alerts**.

## Logging and troubleshooting

Fluent Bit ships container logs from every node to Elasticsearch (`kubernetes-*` indices). Kibana has three saved views: cluster system logs, Sherlock app logs, and pod/container logs (import them as described above).

Retention: the `elasticsearch-log-retention` Job installs an ILM policy that deletes `kubernetes-*` indices after 30 days. Kubelet container logs are also rotated at 10Mi x 5 files (see the `minikube start` flags). Elasticsearch data sits on a 5Gi volume, so check `kubectl -n observability exec statefulset/elasticsearch -- df -h /usr/share/elasticsearch/data` if disk fills.

Common problems:

```bash
# CrashLoopBackOff: read the reason, the last crash's logs, and recent events
kubectl -n sherlock-app describe pod <pod>
kubectl -n sherlock-app logs <pod> --previous
kubectl -n sherlock-app get events --sort-by=.lastTimestamp

# Pending: look for "Insufficient cpu/memory" or unbound PVC in Events
kubectl -n sherlock-app describe pod <pod>
kubectl top nodes
kubectl describe node cluster-chronicles | grep -A8 "Allocated resources"

# App URL does not open: hosts entry, ingress port-forward, ingress rules
kubectl -n sherlock-app get ingress
kubectl -n ingress-nginx get pods
```

A pod blocked by the NetworkPolicies shows as a timeout, not a refusal. Confirm the cluster uses Calico and that the source pod has the labels the policy allows.
