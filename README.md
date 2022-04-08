![image](https://user-images.githubusercontent.com/50857564/162133213-ebafdc68-a137-49c1-8ed1-39dc929d8970.png)
# 예제 - startbuck dilivery

# 평가항목
  * 분석설계
  * SAGA
  * CQRS
  * Correlation / Compensation
  * Req / Resp
  * Gateway
  * Deploy / Pipeline
  * Circuit Breaker
  * Autoscale(HPA)
  * Self-healing(Liveness Probe)
  * Zero-downtime deploy(Readiness Probe)
  * Config Map / Persustemce Volume
  * Polyglot
   
----


# 분석설계
*전반적인 어플리케이션의 구조 및 흐름을 인지한 상태에서 실시한 이벤트 스토밍과정으로, 기초적인 이벤트 도출이나, Aggregation 작업은 `Bounded Context`를 먼저 선정하고 진행*
![image](https://user-images.githubusercontent.com/50857564/162133983-e1d4eda1-3098-4b2b-9557-3177ff15df7d.png)

# SAGA 
+ Kafka 설치

![image](https://user-images.githubusercontent.com/50857564/162357094-d6dea844-aa60-4f94-889b-030ea6b279a3.png)

+ 브로커 SVC 설정 확인

![image](https://user-images.githubusercontent.com/50857564/162357139-c3602096-e8d8-439b-922f-545627f4c718.png)

# Req / Resp (feign client)

* `Interface 선언`을 통해 자동으로 Http Client 생성
* 선언적 Http Client란, Annotation만으로 Http Client를 만들수 있고, 이를 통해서 원격의 Http API호출이 가능

![image](https://user-images.githubusercontent.com/50857564/162356672-0c3e14d4-79d5-4d7c-9923-b215135927b2.png)

![image](https://user-images.githubusercontent.com/50857564/162356398-751addf9-9ba0-4d89-ba00-8ecc2a3360da.png)

+ Run 
![image](https://user-images.githubusercontent.com/50857564/162359712-f61cedb1-815a-4a36-8aac-e03844615417.png)



## Gateway
+ Istio Ingress Gateway 구현

```diff
apiVersion: "networking.istio.io/v1alpha3"
kind: "Gateway"
metadata: 
  name: starbuckdelivery
spec: 
  selector: 
    istio: "ingressgateway"
  servers: 
    - 
      port: 
        number: 80
        name: "http"
        protocol: "HTTP"
      hosts: 
        - "*"
---

apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: vsvc-order
spec:
  gateways:
  - starbuckdelivery
  hosts:
  - "*"
  http:
  - name: primary       # referenced in canary.trafficRouting.istio.virtualService.routes
    match: 
    - uri: 
        exact: "/orders"
    rewrite:
      uri: "/"
    route:
    - destination:
        host: order
        subset: stable  # referenced in canary.trafficRouting.istio.destinationRule.stableSubsetName
      weight: 100
    - destination:
        host: order
        subset: canary  # referenced in canary.trafficRouting.istio.destinationRule.canarySubsetName
      weight: 0
---
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: vsvc-pay
spec:
  gateways:
  - starbuckdelivery
  hosts:
  - "*"
  http:
  - name: primary       # referenced in canary.trafficRouting.istio.virtualService.routes
    match: 
    - uri: 
        exact: "/pays"
    rewrite:
      uri: "/"
    route:
    - destination:
        host: pay
        subset: stable  # referenced in canary.trafficRouting.istio.destinationRule.stableSubsetName
      weight: 100
    - destination:
        host: pay
        subset: canary  # referenced in canary.trafficRouting.istio.destinationRule.canarySubsetName
      weight: 0
---
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: vsvc-store
spec:
  gateways:
  - starbuckdelivery
  hosts:
  - "*"
  http:
  - name: primary       # referenced in canary.trafficRouting.istio.virtualService.routes
    match: 
    - uri: 
        exact: "/stores"
    rewrite:
      uri: "/"
    route:
    - destination:
        host: store
        subset: stable  # referenced in canary.trafficRouting.istio.destinationRule.stableSubsetName
      weight: 100
    - destination:
        host: store
        subset: canary  # referenced in canary.trafficRouting.istio.destinationRule.canarySubsetName
      weight: 0

```	
![image](https://user-images.githubusercontent.com/50857564/162198457-11d80b90-97db-4e55-814b-4c00282a73d0.png)



## Deploy / Pipeline

+ AWS 파이프라인을 통한 Deploy 
```diff
version: 0.2

env:
  variables:
    _PROJECT_NAME: "user05-order"

phases:
  install:
    runtime-versions:
      java: corretto8
      docker: 18
    commands:
      - echo install kubectl
      - curl -LO https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl
      - chmod +x ./kubectl
      - mv ./kubectl /usr/local/bin/kubectl
  pre_build:
    commands:
      - echo Logging in to Amazon ECR...
      - echo $_PROJECT_NAME
      - echo $AWS_ACCOUNT_ID
      - echo $AWS_DEFAULT_REGION
      - echo $CODEBUILD_RESOLVED_SOURCE_VERSION
      - echo start command
      - $(aws ecr get-login --no-include-email --region $AWS_DEFAULT_REGION)
  build:
    commands:
      - echo Build started on `date`
      - echo Building the Docker image...
      - mvn package -Dmaven.test.skip=true
      - docker build -t $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$_PROJECT_NAME:$CODEBUILD_RESOLVED_SOURCE_VERSION  .
  post_build:
    commands:
      - echo Pushing the Docker image...
      - docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$_PROJECT_NAME:$CODEBUILD_RESOLVED_SOURCE_VERSION
      - echo connect kubectl
      - kubectl config set-cluster k8s --server="$KUBE_URL" --insecure-skip-tls-verify=true
      - kubectl config set-credentials admin --token="$KUBE_TOKEN"
      - kubectl config set-context default --cluster=k8s --user=admin
      - kubectl config use-context default
      - |
          cat <<EOF | kubectl apply -f -
          apiVersion: v1
          kind: Service
          metadata:
            name: $_PROJECT_NAME
            labels:
              app: $_PROJECT_NAME
          spec:
            ports:
              - port: 8080
                targetPort: 8080
            selector:
              app: $_PROJECT_NAME
          EOF
      - |
          cat  <<EOF | kubectl apply -f -
          apiVersion: apps/v1
          kind: Deployment
          metadata:
            name: $_PROJECT_NAME
            labels:
              app: $_PROJECT_NAME
          spec:
            replicas: 1
            selector:
              matchLabels:
                app: $_PROJECT_NAME
            template:
              metadata:
                labels:
                  app: $_PROJECT_NAME
              spec:
                containers:
                  - name: $_PROJECT_NAME
                    image: $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$_PROJECT_NAME:$CODEBUILD_RESOLVED_SOURCE_VERSION
                    ports:
                      - containerPort: 8080
                    readinessProbe:
                      httpGet:
                        path: /actuator/health
                        port: 8080
                      initialDelaySeconds: 10
                      timeoutSeconds: 2
                      periodSeconds: 5
                      failureThreshold: 10
                    livenessProbe:
                      httpGet:
                        path: /actuator/health
                        port: 8080
                      initialDelaySeconds: 120
                      timeoutSeconds: 2
                      periodSeconds: 5
                      failureThreshold: 5
          EOF
cache:
  paths:
    - '/root/.m2/**/*'
```
![image](https://user-images.githubusercontent.com/50857564/162190465-26b69ea3-3417-4d85-8f99-1f41f9375ef9.png)


	
## Circuit Breaker

+ DestinationRule 생성
```diff
apiVersion: networking.istio.io/v1alpha3
kind: DestinationRule
metadata:
  name: destrule-store
spec:
  host: store
  trafficPolicy:
    outlierDetection:
      consecutive5xxErrors: 1
      interval: 1s
      baseEjectionTime: 3m
      maxEjectionPercent: 100
```

+ Circuit Breaker 테스트 환경설정(`replicas=3`)

```
root@labs-1973364930:~# kubectl scale deploy user05-order -n startbuck --replicas=3
root@labs-1973364930:~# kubectl get pod -n startbuck
NAME                            READY   STATUS    RESTARTS   AGE
my-kafka-0                      2/2     Running   2          19m
my-kafka-zookeeper-0            2/2     Running   0          19m
user05-order-768fcb5bbd-6h28q   2/2     Running   12         56m
user05-order-768fcb5bbd-7tqmb   2/2     Running   0          36s
user05-order-768fcb5bbd-jhdsf   2/2     Running   0          36s
user05-pay-66c8b5f6d9-fcrw7     2/2     Running   9          49m
user05-store-748c8b9986-vf89c   2/2     Running   9          48m
```
+ 새 터미널에서 Http Client 컨테이너를 설치하고, 접속한다.
```
root@labs-1973364930:~# kubectl create deploy siege --image=ghcr.io/acmexii/siege-nginx:latest -n startbuck
deployment.apps/siege created
root@labs-1973364930:~# kubectl exec -it user05-order-8b6456866-2qtrx -n startbuck /bin/sh
```
+ Circuit Breaker 동작 확인
```diff
+root@siege-75d5587bf6-fns4p:/# siege -c30 -t20S -v --content-type "application/json" 'http://user05-order:8080/actuator/health'

```
+  컨테이너로 접속하여 명시적으로 5xx 오류를 발생 시킨다.
```diff
# 새로운 터미널 Open
# 3개 중 하나의 컨테이너에 접속
root@labs-1973364930:/home/project/circuitbreaker# kubectl exec -it user05-order-bf6b74cdb-jnqjd -n startbuck /bin/sh
Defaulting container name to user05-order.
Use 'kubectl describe pod/user05-order-bf6b74cdb-jnqjd -n startbuck' to see all of the containers in this pod.

# httpie 설치 및 서비스 명시적 다운
apk update
apk add httpie
- http POST http://localhost:8080/actuator/shutdown
```

+ `2개`의 컨테이너만으로 서비스 유실 없이 서비스가 정상으로 처리됨을 확인한다.
![image](https://user-images.githubusercontent.com/50857564/162261587-3890c8d0-28f1-4f70-899c-ff6cb477e5b9.png)



## Config Map
+ PVC 생성
```diff
# spring-boot profile 세팅을 위해 OS 환경 변수 SPRING_PROFILES_ACTIVE, TZ 설정

apiVersion: v1
kind: ConfigMap
metadata:
  name: store-config
data:
 profile-k8s: “docker”
 timezone_seoul: “Asia/Seoul”

---
+ Deployment.yaml 적용
```diff	
spec:
  containers:
      env:
        - name: SPRING_PROFILES_ACTIVE 
          valueFrom:
            configMapKeyRef:
              name: store-config     
              key: profile-k8s 
        - name: TZ
          valueFrom:
            configMapKeyRef:
              name: store-config
              key: timezone_seoul
```



## Polyglot
+ apache  derby db 라이브러리 세팅
    <dependency>
        <groupId>org.apache.derby</groupId>
        <artifactId>derby</artifactId>
        <scope>runtime</scope>
    </dependency>
+ 기동 로그에서 apache derby 확인
![image](https://user-images.githubusercontent.com/50857564/162348986-a63ff935-d2e7-4b72-b82f-17521dc9c5fe.png)

	
	
## Autoscaling

+ Autoscaling 테스트를 위한 k8s pod 에 리소스 설정

```yaml
              spec:
                containers:
                  - name: $_PROJECT_NAME
                    image: $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$_PROJECT_NAME:$CODEBUILD_RESOLVED_SOURCE_VERSION
                    ports:
                      - containerPort: 8080
                    resources:
                      limits:
                        cpu: 500m
                      requests:
                        cpu: 200m
                    readinessProbe:
---

+ Autoscale 설정 및 horizontalpodautoscaler, hpa 확인

![image](https://user-images.githubusercontent.com/50857564/162348210-d60e7797-021d-4543-943f-e7ec4b7ec2d2.png)

```

## Self Healing

+ `livenessProbe` , 'ReadienessProbe' 설정을 deploy.yaml 파일에 작성

```yaml
                    readinessProbe:
                      httpGet:
                        path: /actuator/health
                        port: 8080
                      initialDelaySeconds: 10
                      timeoutSeconds: 2
                      periodSeconds: 5
                      failureThreshold: 10
                    livenessProbe:
                      httpGet:
                        path: /actuator/health
                        port: 8080
                      initialDelaySeconds: 120
                      timeoutSeconds: 2
                      periodSeconds: 5
                      failureThreshold: 5
```
	
+ 팟 내에 진입하여 서비스 down 후 새로운 팟이 생성되고 기존 팟은 제거됨을 확인 
![image](https://user-images.githubusercontent.com/50857564/162353779-7c7deb34-3f0b-471f-b932-ce3b42d9c5cc.png)


+ initialDelaySeconds: init 과정에서 지연이 발생 하여  120 을 적용하여 신규 배포 시 신규 팟 생성 후 헬스 체크 가능한 시점에 svc 연결 확인
	
