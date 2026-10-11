# Cluster Chronicles

Sherlock app and observability stack on a local Minikube cluster. The cluster is already installed; these are the commands for using it.

## Start

```bash
minikube start -p cluster-chronicles
kubectl config use-context cluster-chronicles
kubectl get pods -A
```

## Open

Run each port-forward in its own terminal:

```bash
kubectl -n ingress-nginx port-forward service/ingress-nginx-controller 18080:80
kubectl -n cicd port-forward service/jenkins 18082:8080
kubectl -n observability port-forward service/monitoring-grafana 13000:80
kubectl -n observability port-forward service/kibana 15601:5601
kubectl -n observability port-forward service/monitoring-kube-prometheus-alertmanager 19093:9093
```

- App: `http://sherlock.local:18080/` (map `sherlock.local` to `127.0.0.1` in `/etc/hosts`).
- Jenkins: `http://localhost:18082` → run the `sherlock-app` job.
- Grafana: `http://localhost:13000` → cluster, pod, and Sherlock Application dashboards.
- Kibana: `http://localhost:15601` → Sherlock app logs.
- Alertmanager: `http://localhost:19093/#/alerts`.

## Check

```bash
curl -H 'Host: sherlock.local' http://127.0.0.1:18080/api/health
kubectl get pvc -A
kubectl -n sherlock-app get deployments
```
