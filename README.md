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
```
  - 기능요소
    - 사용자가 배차를 `요청`한다 (OK)
    - 사용자가 `결제`한다 (OK)
    - 결제가 완료되면 택시기사에게 `배차` 요청정보가 전달된다 (OK)
    - 택시기사가 배차를 확정하면 서비스가 시작되고 배차상태가 변경된다 (OK)
  - 비기능요소
    - 마이크로 서비스를 넘나드느 시나리오에 대한 트랜잭션 처리 (OK)
    - 고객 결제처리 : 결제가 완료되지 않은 요청은 `ACID` 트랜잭션 적용(Request/Response 방식처리) (OK)
    - 결제가 완료되면 택시기사에게 배차 요청정보가 전달된다 (OK)
```

 
# SAGA
+ 구현<p>
    서비스를 Local에서 아래와 같은 방법으로 서비스별로 개별적으로 실행한다.
   
```
    cd app
    mvn spring-boot:run
```
```
    cd pay
    mvn spring-boot:run 
```
```
    cd store
    mvn spring-boot:run  
```
```
    cd customer
    python policy-handler.py 
```

+ DDD적용<p>
    3개의 도메인으로 관리되고 있으며 `배차요청(Grab)`, `결제(Payment)`, `배차할당(Allocation)`으로 구성된다.
 
```diff
    
    @Document
    @Table(name="Grab_table")
    public class Grab  {

        @Id
        @GeneratedValue(strategy=GenerationType.AUTO)
        private Long id;
        private Integer grabStatus;
        private String phoneNumber;
        private String startingPoint;
        private String destination;
        private Integer estimatedFee;

+       @PostPersist
        public void onPostPersist(){

            //배차요청
            GrabRequestConfirmed grabRequestConfirmed = new GrabRequestConfirmed();
+           BeanUtils.copyProperties(this, grabRequestConfirmed);
            grabRequestConfirmed.publishAfterCommit();
+           htaxi.external.Payment payment = new htaxi.external.Payment();
            payment.setId(getid());

            GrabApplication.applicationContext.getBean(htaxi.external.PaymentService.class).pay(payment);
            grabCancelled.publishAfterCommit();
        }
```
   
+ 서비스 호출흐름(Sync)<p>
`배차요청(Grab)` -> `결제(Pay)`간 호출은 동기식으로 일관성을 유지하는 트랜젝션으로 처리
* 고객이 목적지를 설정하고 택시 배차를 요청한다.
* 결제서비스를 호출하기위해 FeinClient를 이용하여 인터페이스(Proxy)를 구현한다.
* 배차요청을 받은 직후(`@PostPersist`) 결제를 요청하도록 처리한다.
```
// PaymentService.java

package htaxi.external;

import ...

@FeignClient(name="Payment", url="http://localhost:8080")
public interface PaymentService {
    @RequestMapping(method= RequestMethod.GET, path="/payments")
    public void pay(@RequestBody Payment payment);

}   
```
   
+ 서비스 호출흐름(Async)<p>
* 결제가 완료되면 배차할당시 배차요청내용(승차장소, 목적지, 고객정보등) 택시기사에게 전달하는 행위는 비동기식으로 처리되, `배차할당 상태의 변경이 블로킹 되지 않도록 처리`
* 이를 위해 결제과정에서 기록을 남기고 승인정보를 `Kafka`로 전달한다.
   
```diff
package htaxi;

@Entity
@Table(name="Payment_table")
public class Payment {

...
+   @PrePersist
    public void onPrePersist(){
     	PaymentApproved paymentApproved = new PaymentApproved();
        BeanUtils.copyProperties(this, paymentApproved);
+       paymentApproved.publishAfterCommit();
    }

}

```

* 배차할당관리(Allocation)에서는 결제 승인 Event를 수신해 PolicyHandler에서 후행 작업을 처리한다.
* 택시기사는 수신된 배차정보를 수락하고 승차장소로 이동한다.

```java
package htaxi;

@Service
public class PolicyHandler{
    @StreamListener(KafkaProcessor.INPUT)
    public void wheneverPaymentApproved_ConfirmAllocation(@Payload PaymentApproved paymentApproved){

        if(!paymentApproved.validate()) return;

        System.out.println("\n\n##### 배차할당 받음 : " + paymentApproved.toJson() + "\n\n");
  
  }   
```

 
# CQRS
+ grab 서비스(8081)와 allocate 서비스(8082)를 각각 실행

```
cd grab
mvn spring-boot:run
```

```
cd allocate
mvn spring-boot:run
```

+ taxi에 대한 grab 요청

```sql
http localhost:8081/grabs taxiId=1 taxiNum="서울32저4703"
```

```sql
HTTP/1.1 201
Content-Type: application/json;charset=UTF-8
Date: Tue, 29 Mar 2022 04:12:23 GMT
Location: http://localhost:8081/grabs/1
Transfer-Encoding: chunked

{
    "_links": {
        "grab": {
            "href": "http://localhost:8081/grabs/1"
        },
        "self": {
            "href": "http://localhost:8081/grabs/1"
        }
    },
    "taxiId": 1,
    "taxiNum": "서울32저4703",
}
```

+ 카프카 consumer 이벤트 모니터링

```
/usr/local/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic shopmall --from-beginning
```

```sql
{"eventType":"Grabbed","timestamp":"20220329041223","id":1,"taxiId":1,"taxiNum":"서울32저4703","me":true}
{"eventType":"Allocated","timestamp":"20220329041223","id":1,"grabId":1,"taxiId":1,"taxiNum":"서울32저4703","me":true}
```

+ grabView 서비스를 실행

```
cd grabView
mvn spring-boot:run

```

+ grabView의 Query Model을 통해 Grab상태와 Allocate상태를 `통합조회`

- Query Model 은 발생한 모든 이벤트를 수신하여 자신만의 `View`로 데이터를 통합 조회 가능하게 함

```
http localhost:8090/grabStatuses
```

```sql
HTTP/1.1 200
Content-Type: application/hal+json;charset=UTF-8
Date: Tue, 29 Mar 2022 04:13:00 GMT
Transfer-Encoding: chunked

{
    "_embedded": {
        "grabStatuses": [
            {
                "_links": {
                    "grabStatus": {
                        "href": "http://localhost:8090/grabStatuses/1"
                    },
                    "self": {
                        "href": "http://localhost:8090/grabStatuses/1"
                    }
                },
                "allocateId": 1,
                "allocateStatus": "Allocated",
                "grabStatus": "Grabbed",
                "taxiId": 1,
                "taxiNum": "서울32저4703",
            }
        ]
    },
    "_links": {
        "profile": {
            "href": "http://localhost:8090/profile/grabStatuses"
        },
        "search": {
            "href": "http://localhost:8090/grabStatuses/search"
        },
        "self": {
            "href": "http://localhost:8090/grabStatuses{?page,size,sort}",
            "templated": true
        }
    },
    "page": {
        "number": 0,
        "size": 20,
        "totalElements": 1,
        "totalPages": 1
    }
}
```

+ grabView 에서 grab, allocate, taxi 상태를 통합 조회 가능함
+ Compensation Transaction 테스트(cancel grab)
+ Taxi Grab 취소

```
http DELETE localhost:8081/grabs/1
```

```sql
HTTP/1.1 204
Date: Tue, 29 Mar 2022 04:13:27 GMT
```

+ grab상태와 allocate상태 값을 확인

```
http localhost:8090/grabStatuses
```

```diff
HTTP/1.1 200
Content-Type: application/hal+json;charset=UTF-8
Date: Tue, 29 Mar 2022 04:13:36 GMT
Transfer-Encoding: chunked

{
    "_embedded": {
        "grabStatuses": [
            {
                "_links": {
                    "grabStatus": {
                        "href": "http://localhost:8090/grabStatuses/1"
                    },
                    "self": {
                        "href": "http://localhost:8090/grabStatuses/1"
                    }
                },
                "allocateId": 1,
+                "allocateStatus": "AllocateCancelled",
+                "grabStatus": "GrabCancelled",
                "taxiId": 1,
                "taxiNum": "서울32저4703",
            }
        ]
    },
    "_links": {
        "profile": {
            "href": "http://localhost:8090/profile/grabStatuses"
        },
        "search": {
            "href": "http://localhost:8090/grabStatuses/search"
        },
        "self": {
            "href": "http://localhost:8090/grabStatuses{?page,size,sort}",
            "templated": true
        }
    },
    "page": {
        "number": 0,
        "size": 20,
        "totalElements": 1,
        "totalPages": 1
    }
}
```

+ grab cancel 정보가 grabView에 전달되어 `grabStatus`, `allocateStatus` 모두 cancelled 로 상태 변경 된 것을 통합 조회 가능함
 
 
# Correlation / Compensation
## Correlation Id

+ Correlation Id를 생성하는 로직은 common-module로 구성하였다. 해당 로직은, 모든 컴포넌트에 동일하게 적용하고 컴포넌트 간의 통신은 Json 기반의 Http request를 받았을 때, Filter 에서 생성
```diff
@Slf4j
public class CorrelationIdFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        CorrelationHttpHeaderHelper.prepareCorrelationParams(request);
+       CorrelationLoggerUtil.updateCorrelation();
        filterChain.doFilter(request, response);
        CorrelationLoggerUtil.clear();
    }
 }
```

+ Filter에서는, 요청받은 request 를 확인하여, Correlation-Id가 존재할 경우, 해당 데이터를 식별자로 사용하고, 존재하지 않을 경우에는, 신규 Correlation Id를 생성한다. 관련 로직은 다음과 같다.
```diff
@Slf4j
public class CorrelationHttpHeaderHelper {

    public static void prepareCorrelationParams(HttpServletRequest httpServletRequest) {
        String currentCorrelationId = prepareCorrelationId(httpServletRequest);
+       setCorrelations(httpServletRequest, currentCorrelationId);
        log.debug("Request Correlation Parameters : ");
        CorrelationHeaderField[] headerFields = CorrelationHeaderField.values();
        for (CorrelationHeaderField field : headerFields) {
            String value = CorrelationHeaderUtil.get(field);
            log.debug("{} : {}", field.getValue(), value);
        }
    }

    private static String prepareCorrelationId(HttpServletRequest httpServletRequest) {
+        String currentCorrelationId = httpServletRequest.getHeader(CorrelationHeaderField.CORRELATION_ID.getValue());
        if (currentCorrelationId == null) {
            currentCorrelationId = CorrelationContext.generateId();
            log.trace("Generated Correlation Id: {}", currentCorrelationId);
        } else {
            log.trace("Incoming Correlation Id: {}", currentCorrelationId);
        }
        return currentCorrelationId;
    }
} 
```

## Compensation

+ `Correlation Id` 정보를 기반으로 kafka를 이용한 비동기방식의 Compensation Transaction 처리
```diff
package com.example.kafkapub.publish;

import ...

@Component
+ public class GreetingProducer {
    @Autowired
    private KafkaTemplate<String, Greeting> greetingKafkaTemplate;

    @Value(value = "${greeting.topic.name}")
    private String greetingTopicName;

    public void sendMessage(Greeting greeting) {
        ListenableFuture<SendResult<String, Greeting>> future = greetingKafkaTemplate.send(greetingTopicName, greeting);

        future.addCallback(new ListenableFutureCallback<SendResult<String, Greeting>>() {
            @Override
            public void onSuccess(SendResult<String, Greeting> result) {
                Greeting g = result.getProducerRecord().value();
                System.out.println("Sent message=[" + g.toString() + "] with offset=[" + result.getRecordMetadata().offset() + "]");
            }

            @Override
            public void onFailure(Throwable ex) {
                // needed to do compensation transaction.
                System.out.println( "Unable to send message=[" + greeting.toString() + "] due to : " + ex.getMessage());
            }
        });
    }
}
```

```diff
package com.example.kafkasub.consume;

import ...

@Component
+ public class GreetingConsumer {

    @KafkaListener(topics = "${greeting.topic.name}", containerFactory = "greetingKafkaListenerContainerFactory")
+    public void greetingListener(Greeting greeting, Acknowledgment ack) {
        try {
            System.out.println("----Received Message----");
            System.out.println("id: " + greeting.getName());
            System.out.println("act: " + greeting.getMsg());

            ack.acknowledge();
        } catch (Exception e) {
            // 에러 처리
        }
    }
}

```

```diff
// Producer Log
2022-03-29 03:46:21.665  INFO 15252 --- [nio-8081-exec-1] o.a.c.c.C.[Tomcat].[localhost].[/]       : Initializing Spring DispatcherServlet 'dispatcherServlet'
2022-03-29 03:46:21.665  INFO 15252 --- [nio-8081-exec-1] o.s.web.servlet.DispatcherServlet        : Initializing Servlet 'dispatcherServlet'
2022-03-29 03:46:21.668  INFO 15252 --- [nio-8081-exec-1] o.s.web.servlet.DispatcherServlet        : Completed initialization in 3 ms
2022-03-29 03:47:07.604  INFO 15252 --- [nio-8081-exec-4] o.a.k.clients.producer.ProducerConfig    : ProducerConfig values: 
	...
    
2022-03-29 03:47:07.625  INFO 15252 --- [nio-8081-exec-4] o.a.kafka.common.utils.AppInfoParser     : Kafka version: 2.3.1
2022-03-29 03:47:07.625  INFO 15252 --- [nio-8081-exec-4] o.a.kafka.common.utils.AppInfoParser     : Kafka commitId: 18a913733fb71c01
2022-03-29 03:47:07.625  INFO 15252 --- [nio-8081-exec-4] o.a.kafka.common.utils.AppInfoParser     : Kafka startTimeMs: 1648493227624
2022-03-29 03:47:07.689  INFO 15252 --- [ad | producer-1] org.apache.kafka.clients.Metadata        : [Producer clientId=producer-1] Cluster ID: PrON0srhTnuKFQX6k4LXNA
+ Sent message=[refund, 202203290347-189237!] with offset=[10]

```

```diff
// Consumer Log
----Received Message----
+ id: 202203290347-189237
+ act: refund
```

<img src = '/images/Screen Shot 2022-03-29 at 4.00.37.png'>


# Req / Resp (feign client)

* `Interface 선언`을 통해 자동으로 Http Client 생성
* 선언적 Http Client란, Annotation만으로 Http Client를 만들수 있고, 이를 통해서 원격의 Http API호출이 가능
 
+ Dependency 추가
```diff
dependencies {
    ...
    
    /** feign client*/
+    implementation 'org.springframework.cloud:spring-cloud-starter-openfeign'
+    implementation group: 'io.github.openfeign', name: 'feign-gson', version: '11.0'

    /** spring web*/
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation 'junit:junit:4.13.1'
    compileOnly 'org.projectlombok:lombok'
    annotationProcessor 'org.springframework.boot:spring-boot-configuration-processor'
    annotationProcessor 'org.projectlombok:lombok'
    
    ...
}
```

+ Controller
```diff
package com.example.feigntest.controller;

import ...

@Slf4j
@RestController
@RequiredArgsConstructor
public class HTaxiFeignController {

    private final HTaxiFeignService HTaxiFeignService;

+   @GetMapping(value = "/v1/github/{owner}/{repo}")
    public List<Contributor> getHTaxiContributors(@PathVariable String owner , @PathVariable String repo){
        return HTaxiFeignService.getContributor(owner,repo);
    }
}

```

+ Service
```diff
package com.example.feigntest.service;

import ...

@Slf4j
@Service
public class HTaxiFeignService {

  @Autowired
  private HTaxiFeignClient hTaxiFeignClient;

  public List<Contributor> getContributor(String owner, String repo) {
    List<Contributor> contributors = hTaxiFeignClient.getContributor(owner, repo);
    return contributors;
  }
}

```

+ FeignClient Interface
```diff
package com.example.feigntest.client;

import ...

- @FeignClient(name="feign", url="https://api.github.com/repos",configuration = Config.class)
public interface HTaxiFeignClient {
    @RequestMapping(method = RequestMethod.GET , value = "/{owner}/{repo}/contributors")
    List<Contributor> getContributor(@PathVariable("owner") String owner, @PathVariable("repo") String repo);
}


```

+ DTO
```java
package com.example.feigntest.dto;

import lombok.Data;

@Data
public class Contributor {
    String login;
    String id;
    String type;
    String site_admin;
}	
```
	
	
+ `@EnableFeignClients` Set
```diff
package com.example;

import ...
- @EnableFeignClients
@SpringBootApplication
public class ApiTestApplication {

    public static void main(String[] args) {
        SpringApplication.run(ApiTestApplication.class, args);
    }

}

```

+ Run 
<img src = '/images/Screen Shot 2022-03-29 at 0.54.37.png' width="900px">


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
+ Siege로 서비스를 호출해 본다.
```
http GET http://h-taxi-grap:8080/actuator/health
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

+ yaml 파일 적용 후 LoadBalancer 타입으로 배포

```
kubectl apply -f h-taxi-grab-liveness.yaml
kubectl expose deploy h-taxi-grab --type=LoadBalancer --port=8080
kubectl get svc
``

+ 팟 내에 진입하여 서비스 down 후 새로운 팟이 생성되고 기존 팟은 제거됨을 확인
![image](https://user-images.githubusercontent.com/50857564/162353779-7c7deb34-3f0b-471f-b932-ce3b42d9c5cc.png)


