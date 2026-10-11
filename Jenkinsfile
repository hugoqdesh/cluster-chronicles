pipeline {
  agent {
    kubernetes {
      // shortcut: ConfigMaps hold this small app source; use a volume if it grows past 1 MiB.
      yaml '''
apiVersion: v1
kind: Pod
spec:
  serviceAccountName: jenkins
  volumes:
    - name: backend-source
      configMap:
        name: sherlock-backend-source
    - name: frontend-source
      configMap:
        name: sherlock-frontend-source
  containers:
    - name: kaniko-backend
      image: ghcr.io/osscontainertools/kaniko:debug
      command: ["/busybox/cat"]
      tty: true
      volumeMounts:
        - name: backend-source
          mountPath: /source/backend
    - name: kaniko-frontend
      image: ghcr.io/osscontainertools/kaniko:debug
      command: ["/busybox/cat"]
      tty: true
      volumeMounts:
        - name: frontend-source
          mountPath: /source/frontend
    - name: kubectl
      image: alpine/kubectl:1.37.0
      command: ["cat"]
      tty: true
'''
    }
  }

  options { skipDefaultCheckout() }

  stages {
    stage('Choose image tag') {
      steps {
        script {
          env.IMAGE_TAG = "build-${env.BUILD_NUMBER}"
        }
      }
    }

    stage('Build and push backend') {
      steps {
        container(name: 'kaniko-backend', shell: '/busybox/sh') {
          sh '''#!/busybox/sh
set -eu
test -s /source/backend/Dockerfile
test -s /source/backend/package-lock.json
/kaniko/executor \
  --context "dir:///source/backend" \
  --dockerfile "/source/backend/Dockerfile" \
  --destination "registry.kube-system.svc.cluster.local:80/sherlock-backend:${IMAGE_TAG}" \
  --insecure
'''
        }
      }
    }

    stage('Build and push frontend') {
      steps {
        container(name: 'kaniko-frontend', shell: '/busybox/sh') {
          sh '''#!/busybox/sh
set -eu
test -s /source/frontend/Dockerfile
test -s /source/frontend/index.html
/kaniko/executor \
  --context "dir:///source/frontend" \
  --dockerfile "/source/frontend/Dockerfile" \
  --destination "registry.kube-system.svc.cluster.local:80/sherlock-frontend:${IMAGE_TAG}" \
  --insecure
'''
        }
      }
    }

    stage('Deploy and verify') {
      steps {
        container('kubectl') {
          sh '''#!/bin/sh
set -eu
kubectl -n sherlock-app set image deployment/backend \
  backend="localhost:5000/sherlock-backend:${IMAGE_TAG}"
kubectl -n sherlock-app set image deployment/frontend \
  frontend="localhost:5000/sherlock-frontend:${IMAGE_TAG}"

kubectl -n sherlock-app rollout status deployment/backend --timeout=180s
kubectl -n sherlock-app rollout status deployment/frontend --timeout=180s
'''
        }
      }
    }
  }
}
