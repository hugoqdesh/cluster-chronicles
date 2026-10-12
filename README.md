# Cluster Chronicles

Kubernetes migration of the Sherlock app to a local Minikube cluster, with Jenkins, persistent storage, Prometheus/Grafana, and Elasticsearch/Fluent Bit/Kibana.

## Requirements

Docker, Minikube, `kubectl`, Helm, and `crane` (used by `scripts/push-images.sh`). Start Docker before Minikube.

## Install

Start the cluster with the addons used by the manifests:

```bash
minikube start -p cluster-chronicles --cpus=6 --memory=8192 --cni=calico --addons=ingress,metrics-server,registry
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
  -f manifests/monitoring/backend-servicemonitor.yaml \
  -f manifests/monitoring/alerts.yaml \
  -f manifests/monitoring/alert-receiver.yaml

kubectl apply -f manifests/logging/elasticsearch.yaml
kubectl -n observability rollout status statefulset/elasticsearch --timeout=5m
kubectl -n observability exec statefulset/elasticsearch -- bin/elasticsearch-reset-password -u kibana_system -i
kubectl apply -f manifests/logging/kibana.yaml

helm upgrade --install fluent-bit fluent/fluent-bit \
  -n observability -f manifests/logging/fluent-bit-values.yaml
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

Create a Jenkins Pipeline job named `sherlock-app` using this repository's `Jenkinsfile`, then run it to build and deploy updated images. Jenkins pushes through the in-cluster registry service; Minikube pulls the published images through `localhost:5000`.

Minikube's default StorageClass dynamically provisions the PVCs used by Jenkins, Prometheus, Grafana, and Elasticsearch. The storage choices are documented in [manifests/storage/README.md](manifests/storage/README.md); check claims with `kubectl get pvc -A`.

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

After import, Saved Objects should contain the **Kubernetes logs** data view and these searches: **Cluster system logs**, **Sherlock app logs**, and **Backend container logs**. Open a search there to view matching logs.

Verify the app route, workloads, and storage:

```bash
curl -H 'Host: sherlock.local' http://127.0.0.1:18080/api/health
kubectl -n sherlock-app get deployments,pods,services
kubectl get pvc -A
```
